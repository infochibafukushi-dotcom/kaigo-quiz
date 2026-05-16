export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS,PATCH",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === "/api/questions" && request.method === "GET") {
        const admin = url.searchParams.get("admin") === "1";
        const dbJson = await buildQuizJson(env.DB, admin);
        return json(dbJson, cors);
      }

      if (url.pathname === "/api/questions" && request.method === "POST") {
        const body = await request.json();
        console.log("REQ BODY", JSON.stringify(body, null, 2));
        if (!body.courseId || !body.unitId) {
          return json({ error: "courseId/unitId missing" }, cors, 400);
        }
        const result = await upsertQuestion(env.DB, body);
        return json({ ok: true, ...result }, cors);
      }

      if (url.pathname.startsWith("/api/questions/") && request.method === "PUT") {
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isFinite(id) || id <= 0) return json({ error: "invalid id" }, cors, 400);

        const body = await request.json();
        console.log("REQ BODY", JSON.stringify(body, null, 2));
        if (!body.courseId || !body.unitId) {
          return json({ error: "courseId/unitId missing" }, cors, 400);
        }

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

      if (url.pathname.startsWith("/api/units/") && request.method === "PATCH") {
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isFinite(id) || id <= 0) return json({ error: "invalid unit id" }, cors, 400);
        const body = await request.json();
        const isVisible = body?.isVisible === false ? 0 : 1;
        const res = await env.DB.prepare("UPDATE units SET is_visible=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(isVisible, id).run();
        if (!res.meta?.changes) return json({ error: "unit not found" }, cors, 404);
        return json({ ok: true }, cors);
      }

      return new Response("Not found", { status: 404, headers: cors });
    } catch (error) {
      const status = Number(error?.status) || 500;
      return json({ error: String(error?.message || error) }, cors, status);
    }
  }
};

function json(data, cors, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors }
  });
}

async function buildQuizJson(DB, admin = false) {
  const { results } = await DB.prepare(`
    WITH course_ids AS (
      SELECT course, MIN(id) AS course_id
      FROM units
      GROUP BY course
    )
    SELECT q.*, u.id AS unit_id, u.is_visible, c.course_id
    FROM questions q
    INNER JOIN units u ON u.course = q.course AND u.title = q.unit
    INNER JOIN course_ids c ON c.course = q.course
    ORDER BY q.course ASC, q.unit ASC, q.sort_order ASC, q.id ASC
  `).all();

  const courseMap = new Map();
  for (const row of results) {
    if (!admin && Number(row.is_visible ?? 1) === 0) continue;

    const courseName = row.course;
    const unitName = row.unit;
    const courseId = Number(row.course_id);
    const unitId = Number(row.unit_id);
    if (!courseId || !unitId) {
      throw new Error(`API response missing IDs: id not found for ${courseName} / ${unitName}`);
    }

    if (!courseMap.has(courseName)) {
      courseMap.set(courseName, {
        id: courseId,
        courseId,
        title: courseName,
        units: new Map()
      });
    }

    const courseObj = courseMap.get(courseName);
    if (!courseObj.units.has(unitName)) {
      courseObj.units.set(unitName, {
        id: unitId,
        unitId,
        title: unitName,
        isVisible: Number(row.is_visible ?? 1) !== 0,
        questions: []
      });
    }

    courseObj.units.get(unitName).questions.push(rowToQuestion(row, courseId, unitId));
  }

  return {
    appTitle: "カイゴクイズ",
    courses: [...courseMap.values()].map((c) => ({
      id: c.id,
      courseId: c.courseId,
      title: c.title,
      units: [...c.units.values()]
    }))
  };
}

function rowToQuestion(row, courseId, unitId) {
  const choices = safeJson(row.choices_json, []);
  const answers = safeJson(row.answer_json, []);
  const q = {
    id: row.id,
    courseId,
    unitId,
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
  const resolved = await resolveCourseUnitNames(DB, payload.courseId, payload.unitId);
  console.log("RESOLVED UNIT", JSON.stringify({ id: resolved.unitId, title: resolved.unit }, null, 2));
  console.log("RESOLVED COURSE", JSON.stringify({ id: resolved.courseId, title: resolved.course }, null, 2));

  const answers = payload.type === "ox" || payload.type === "choice"
    ? [payload.answer || ""]
    : (payload.answers || []);

  const values = [
    payload.type,
    payload.question || "",
    JSON.stringify(payload.choices || []),
    JSON.stringify(answers),
    Number(payload.blankCount || 0),
    resolved.course,
    resolved.unit,
    payload.explanation || "",
    payload.imageData || payload.imageUrl || "",
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

async function resolveCourseUnitNames(DB, courseIdRaw, unitIdRaw) {
  const requestedCourseId = Number(courseIdRaw);
  const requestedUnitId = Number(unitIdRaw);
  if (!Number.isFinite(requestedCourseId) || requestedCourseId <= 0 || !Number.isFinite(requestedUnitId) || requestedUnitId <= 0) {
    const err = new Error("courseId/unitId missing");
    err.status = 400;
    throw err;
  }

  const unitRow = await DB.prepare("SELECT id, course, title FROM units WHERE id = ?").bind(requestedUnitId).first();
  if (!unitRow) {
    const err = new Error("unit not found");
    err.status = 400;
    throw err;
  }

  const courseIdRow = await DB.prepare(`
    SELECT MIN(id) AS course_id
    FROM units
    WHERE course = ?
  `).bind(unitRow.course).first();

  const resolvedCourseId = Number(courseIdRow?.course_id || 0);
  if (!resolvedCourseId || resolvedCourseId !== requestedCourseId) {
    const err = new Error("courseId/unitId mismatch");
    err.status = 400;
    throw err;
  }

  return {
    courseId: resolvedCourseId,
    unitId: Number(unitRow.id),
    course: unitRow.course,
    unit: unitRow.title
  };
}
