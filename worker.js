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


      if (url.pathname === "/api/units" && request.method === "POST") {
        const body = await request.json();
        const course = String(body?.course || "").trim();
        const title = String(body?.title || "").trim();
        if (!course || !title) return json({ error: "course/title missing" }, cors, 400);
        await env.DB.prepare(`
          INSERT INTO units (course, title, is_visible)
          VALUES (?, ?, 1)
          ON CONFLICT(course, title) DO UPDATE SET
            is_visible=excluded.is_visible,
            updated_at=CURRENT_TIMESTAMP
        `).bind(course, title).run();
        const row = await env.DB.prepare("SELECT id, course, title, is_visible FROM units WHERE course = ? AND title = ?").bind(course, title).first();
        if (!row?.id) return json({ error: "unit create failed" }, cors, 500);

        const courseIdRow = await env.DB.prepare(`
          SELECT MIN(id) AS course_id
          FROM units
          WHERE course = ?
        `).bind(course).first();
        const courseId = Number(courseIdRow?.course_id || 0);
        const unitId = Number(row.id || 0);
        return json({
          ok: true,
          unit: {
            id: unitId,
            unitId,
            courseId,
            title: row.title,
            course: row.course,
            isVisible: Number(row.is_visible ?? 1) !== 0
          }
        }, cors);
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

const CANONICAL_UNITS = [
  "人間の尊厳と自立",
  "介護の基本",
  "コミュニケーション技術",
  "社会の理解",
  "認知症の理解",
  "発達と老化の理解",
  "障害の理解",
  "こころとからだのしくみ1",
  "こころとからだのしくみ2",
  "介護過程1",
  "介護過程2"
];

const UNIT_ORDER = new Map(CANONICAL_UNITS.map((name, i) => [name, i]));
const UNIT_ALIAS = new Map([
  ["こころとからだのしくみ①", "こころとからだのしくみ1"],
  ["こころとからだのしくみ１", "こころとからだのしくみ1"],
  ["こころとからだのしくみⅠ", "こころとからだのしくみ1"],
  ["こころとからだのしくみ②", "こころとからだのしくみ2"],
  ["こころとからだのしくみ２", "こころとからだのしくみ2"],
  ["こころとからだのしくみⅡ", "こころとからだのしくみ2"],
  ["介護過程①", "介護過程1"],
  ["介護過程１", "介護過程1"],
  ["介護過程Ⅰ", "介護過程1"],
  ["介護過程②", "介護過程2"],
  ["介護過程２", "介護過程2"],
  ["介護過程Ⅱ", "介護過程2"]
]);

function normalizeUnitTitle(input) {
  const raw = String(input || "").trim();
  if (!raw) return raw;
  const collapsed = raw.replace(/[ 　]+/g, "");
  const alias = UNIT_ALIAS.get(collapsed);
  if (alias) return alias;
  const canonical = CANONICAL_UNITS.find((x) => x === collapsed);
  return canonical || raw;
}

async function buildQuizJson(DB, admin = false) {
  const unitsResult = await DB.prepare(`
    WITH course_ids AS (
      SELECT course, MIN(id) AS course_id
      FROM units
      GROUP BY course
    )
    SELECT u.id AS unit_id, u.course, u.title AS unit_title, u.is_visible, c.course_id
    FROM units u
    INNER JOIN course_ids c ON c.course = u.course
    ORDER BY u.course ASC, u.title ASC, u.id ASC
  `).all();

  const courseMap = new Map();
  for (const row of (unitsResult.results || [])) {
    if (!admin && Number(row.is_visible ?? 1) === 0) continue;

    const courseName = row.course;
    const unitName = normalizeUnitTitle(row.unit_title);
    const courseId = Number(row.course_id);
    const unitId = Number(row.unit_id);
    if (!courseId || !unitId) {
      throw new Error(`API response missing IDs: id not found for ${courseName} / ${unitName}`);
    }

    if (!courseMap.has(courseName)) {
      courseMap.set(courseName, {
        id: courseId,
        courseId: courseId,
        title: courseName,
        units: new Map()
      });
    }

    const courseObj = courseMap.get(courseName);
    if (!courseObj.units.has(unitName)) {
      courseObj.units.set(unitName, {
        id: unitId,
        unitId: unitId,
        title: unitName,
        isVisible: Number(row.is_visible ?? 1) !== 0,
        questions: []
      });
    }
  }

  const questionsResult = await DB.prepare(`
    SELECT q.*, u.id AS unit_id
    FROM questions q
    INNER JOIN units u ON u.course = q.course AND u.title = q.unit
    ORDER BY q.course ASC, q.unit ASC, q.sort_order ASC, q.id ASC
  `).all();

  for (const row of (questionsResult.results || [])) {
    const courseObj = courseMap.get(row.course);
    if (!courseObj) continue;
    const normalizedUnitName = normalizeUnitTitle(row.unit);
    let unitObj = courseObj?.units?.get(normalizedUnitName);
    if (!unitObj) {
      unitObj = {
        id: Number(row.unit_id),
        unitId: Number(row.unit_id),
        title: normalizedUnitName,
        isVisible: true,
        questions: []
      };
      courseObj.units.set(normalizedUnitName, unitObj);
    }
    unitObj.questions.push(rowToQuestion(row, courseObj.courseId, unitObj.unitId));
  }

  return {
    appTitle: "カイゴクイズ",
    courses: [...courseMap.values()].map((c) => ({
      id: c.id,
      courseId: c.courseId,
      title: c.title,
      units: [...c.units.values()]
        .sort((a, b) => {
          const ao = UNIT_ORDER.has(a.title) ? UNIT_ORDER.get(a.title) : Number.MAX_SAFE_INTEGER;
          const bo = UNIT_ORDER.has(b.title) ? UNIT_ORDER.get(b.title) : Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          if (a.title !== b.title) return String(a.title).localeCompare(String(b.title), "ja");
          return Number(a.unitId) - Number(b.unitId);
        })
        .map((u) => ({
        id: u.id,
        unitId: u.unitId,
        title: u.title,
        isVisible: u.isVisible,
        questions: (u.questions || []).map((q) => ({
          ...q,
          courseId: q.courseId ?? c.courseId,
          unitId: q.unitId ?? u.unitId
        }))
        }))
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
