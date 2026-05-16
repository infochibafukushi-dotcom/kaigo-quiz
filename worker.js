export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === "/api/questions" && request.method === "GET") {
        const isAdmin = url.searchParams.get("admin") === "1";
        const dbJson = await buildQuizJson(env.DB, { includeHiddenUnits: isAdmin });
        return json(dbJson, cors);
      }
      if (url.pathname === "/api/units" && request.method === "GET") {
        const isAdmin = url.searchParams.get("admin") === "1";
        const units = await listUnits(env.DB, { includeHidden: isAdmin });
        return json({ units }, cors);
      }
      if (url.pathname.startsWith("/api/units/") && url.pathname.endsWith("/visibility") && request.method === "PATCH") {
        const parts = url.pathname.split("/");
        const id = Number(parts[3]);
        if (!Number.isFinite(id) || id <= 0) return json({ error: "invalid id" }, cors, 400);
        const body = await request.json();
        const isVisible = body?.is_visible;
        if (typeof isVisible !== "boolean") return json({ error: "is_visible must be boolean" }, cors, 400);
        const res = await env.DB.prepare(`
          UPDATE units SET is_visible=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
        `).bind(isVisible ? 1 : 0, id).run();
        if (!res.meta?.changes) return json({ error: "unit not found" }, cors, 404);
        return json({ ok: true }, cors);
      }

      if (url.pathname === "/api/questions" && request.method === "POST") {
        const body = await request.json();
        const result = await upsertQuestion(env.DB, body);
        return json({ ok: true, ...result }, cors);
      }

      if (url.pathname.startsWith("/api/questions/") && request.method === "PUT") {
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isFinite(id) || id <= 0) return json({ error: "invalid id" }, cors, 400);
        const body = await request.json();
        const result = await upsertQuestion(env.DB, body, id);
        if (result.action !== "updated") return json({ error: "question not found" }, cors, 404);
        return json({ ok: true, ...result }, cors);
      }

      if (url.pathname.startsWith("/api/questions/") && request.method === "DELETE") {
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isFinite(id) || id <= 0) return json({ error: "invalid id" }, cors, 400);
        const res = await env.DB.prepare("DELETE FROM questions WHERE id = ?").bind(id).run();
        if (!res.meta?.changes) return json({ error: "question not found" }, cors, 404);
        return json({ ok: true }, cors);
      }

      if (url.pathname === "/api/upload" && request.method === "POST") {
        const contentType = request.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("multipart/form-data")) {
          return json({ error: "content-type must be multipart/form-data" }, cors, 400);
        }
        const formData = await request.formData();
        const file = formData.get("file");
        if (!file || typeof file.arrayBuffer !== "function") {
          return json({ error: "file is required" }, cors, 400);
        }
        const ext = (file.name?.split(".").pop() || "bin").toLowerCase();
        const key = `quiz-images/${crypto.randomUUID()}.${ext}`;
        const bucket = env.QUIZ_IMAGES || env.IMAGES;
        if (!bucket) return json({ error: "R2 binding is missing (QUIZ_IMAGES/IMAGES)" }, cors, 500);
        await bucket.put(key, await file.arrayBuffer(), {
          httpMetadata: { contentType: file.type || "application/octet-stream" }
        });
        const publicBaseUrl = String(env.R2_PUBLIC_BASE_URL || "").trim();
        if (!publicBaseUrl) {
          return json({ error: "R2_PUBLIC_BASE_URL is not configured" }, cors, 500);
        }
        const imageUrl = `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
        return json({ imageUrl }, cors);
      }

      return new Response("Not found", { status: 404, headers: cors });
    } catch (error) {
      return json({ error: String(error?.message || error) }, cors, 500);
    }
  }
};

function json(data, cors, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors }
  });
}

async function buildQuizJson(DB, options = {}) {
  const includeHiddenUnits = Boolean(options.includeHiddenUnits);
  const { results } = await DB.prepare(`
    SELECT q.*, u.id AS unit_id, COALESCE(u.is_visible, 1) AS unit_is_visible
    FROM questions q
    LEFT JOIN units u
      ON u.course = q.course AND u.title = q.unit
    ${includeHiddenUnits ? "" : "WHERE COALESCE(u.is_visible, 1) = 1"}
    ORDER BY q.course ASC, q.unit ASC, q.sort_order ASC, q.id ASC
  `).all();

  const courseMap = new Map();
  for (const row of results) {
    const courseName = row.course || "未分類";
    const unitName = row.unit || "未分類";
    if (!courseMap.has(courseName)) courseMap.set(courseName, new Map());
    const unitMap = courseMap.get(courseName);
    if (!unitMap.has(unitName)) unitMap.set(unitName, []);
    const list = unitMap.get(unitName);
    if (!list.length) {
      list.meta = { id: row.unit_id || null, isVisible: Boolean(row.unit_is_visible) };
    }
    list.push(rowToQuestion(row));
  }

  return {
    appTitle: "カイゴクイズ",
    courses: [...courseMap.entries()].map(([course, units]) => ({
      title: course,
      units: [...units.entries()].map(([unit, questions]) => ({
        id: questions.meta?.id || null,
        title: unit,
        isVisible: questions.meta?.isVisible !== false,
        questions
      }))
    }))
  };
}

async function listUnits(DB, options = {}) {
  const includeHidden = Boolean(options.includeHidden);
  const { results } = await DB.prepare(`
    SELECT id, course, title, is_visible
    FROM units
    ${includeHidden ? "" : "WHERE is_visible = 1"}
    ORDER BY course ASC, title ASC, id ASC
  `).all();
  return results.map((row) => ({
    id: row.id,
    course: row.course,
    title: row.title,
    is_visible: Boolean(row.is_visible)
  }));
}

function rowToQuestion(row) {
  const choices = safeJson(row.choices_json, []);
  const answers = safeJson(row.answer_json, []);
  const q = {
    id: row.id,
    type: row.type,
    question: row.question || "",
    explanation: row.explanation || ""
  };
  if (choices.length) q.choices = choices;
  if (row.blank_count) q.blankCount = row.blank_count;
  if (row.image_url) q.imageUrl = row.image_url;
  if (row.type === "ox" || row.type === "choice") q.answer = answers[0] || "";
  else q.answers = answers;
  return q;
}

function safeJson(text, fallback) {
  try { return JSON.parse(text || ""); } catch { return fallback; }
}

async function upsertQuestion(DB, payload, forcedId = null) {
  await DB.prepare(`
    INSERT OR IGNORE INTO units (course, title, is_visible) VALUES (?, ?, 1)
  `).bind(payload.course || "未分類", payload.unit || "未分類").run();

  const answers = payload.type === "ox" || payload.type === "choice"
    ? [payload.answer || ""]
    : (payload.answers || []);

  const values = [
    payload.type,
    payload.question || "",
    JSON.stringify(payload.choices || []),
    JSON.stringify(answers),
    Number(payload.blankCount || 0),
    payload.course || "未分類",
    payload.unit || "未分類",
    payload.explanation || "",
    payload.imageUrl || "",
    Number(payload.sortOrder || 0)
  ];

  if (forcedId !== null) {
    const res = await DB.prepare(`
      UPDATE questions
      SET type=?, question=?, choices_json=?, answer_json=?, blank_count=?,
          course=?, unit=?, explanation=?, image_url=?, sort_order=?,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(...values, forcedId).run();
    return { action: "updated", id: forcedId, changes: Number(res.meta?.changes || 0) };
  }

  const payloadId = Number(payload.id);
  if (Number.isFinite(payloadId) && payloadId > 0) {
    const res = await DB.prepare(`
      UPDATE questions
      SET type=?, question=?, choices_json=?, answer_json=?, blank_count=?,
          course=?, unit=?, explanation=?, image_url=?, sort_order=?,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(...values, payloadId).run();
    if (Number(res.meta?.changes || 0) > 0) {
      return { action: "updated", id: payloadId, changes: Number(res.meta?.changes || 0) };
    }
  }

  const insertRes = await DB.prepare(`
    INSERT INTO questions (
      type, question, choices_json, answer_json, blank_count,
      course, unit, explanation, image_url, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(...values).run();
  return { action: "inserted", id: Number(insertRes.meta?.last_row_id || 0), changes: Number(insertRes.meta?.changes || 0) };
}
