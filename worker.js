const CANONICAL_COURSE_TITLE = "介護福祉士実務者研修";

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

const UNIT_ALIASES = new Map([
  ["老化の理解", "発達と老化の理解"],
  ["発達と老化", "発達と老化の理解"],
  ["こころとからだのしくみ", "こころとからだのしくみ1"],
  ["こころとからだのしくみⅠ", "こころとからだのしくみ1"],
  ["こころとからだのしくみ１", "こころとからだのしくみ1"],
  ["こころとからだのしくみ①", "こころとからだのしくみ1"],
  ["こころとからだのしくみⅡ", "こころとからだのしくみ2"],
  ["こころとからだのしくみ２", "こころとからだのしくみ2"],
  ["こころとからだのしくみ②", "こころとからだのしくみ2"],
  ["介護過程Ⅰ", "介護過程1"],
  ["介護過程１", "介護過程1"],
  ["介護過程①", "介護過程1"],
  ["介護過程Ⅱ", "介護過程2"],
  ["介護過程２", "介護過程2"],
  ["介護過程②", "介護過程2"]
]);

const UNIT_ORDER = new Map(CANONICAL_UNITS.map((name, index) => [name, index]));

const ALLOWED_ORIGINS = new Set([
  "https://infochibafukushi-dotcom.github.io"
]);

export default {
  async fetch(request, env) {
    const corsHeaders = getCorsHeaders(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    try {
      validateEnv(env);

      const url = new URL(request.url);
      const pathname = normalizePath(url.pathname);

      if (pathname === "/" || pathname === "") {
        return json({ ok: true, app: "kaigo-quiz-worker" }, 200, corsHeaders);
      }

      if (pathname === "/api/health") {
        await ensureSchema(env);
        return json({ ok: true }, 200, corsHeaders);
      }

      if (pathname === "/api/init-db") {
        const mode = url.searchParams.get("mode") || "replace";
        await initDb(env, mode);
        return json({
          ok: true,
          mode,
          message: mode === "append" ? "DB append-ready" : "DB initialized",
          course: CANONICAL_COURSE_TITLE,
          units: CANONICAL_UNITS
        }, 200, corsHeaders);
      }

      if (pathname === "/api/questions" && request.method === "GET") {
        await ensureSchema(env);
        await ensureCanonicalUnits(env);
        return json(await buildQuizJson(env), 200, corsHeaders);
      }

      if (pathname === "/api/questions" && request.method === "POST") {
        await ensureSchema(env);
        const body = await safeJson(request);
        const saved = await createQuestion(env, body);
        return json({ ok: true, question: saved }, 200, corsHeaders);
      }

      const questionMatch = pathname.match(/^\/api\/questions\/(\d+)$/);
      if (questionMatch && request.method === "PUT") {
        await ensureSchema(env);
        const id = Number(questionMatch[1]);
        const body = await safeJson(request);
        const saved = await updateQuestion(env, id, body);
        return json({ ok: true, question: saved }, 200, corsHeaders);
      }

      if (questionMatch && request.method === "DELETE") {
        await ensureSchema(env);
        const id = Number(questionMatch[1]);
        await env.DB.prepare("DELETE FROM questions WHERE id = ?").bind(id).run();
        return json({ ok: true }, 200, corsHeaders);
      }

      if (pathname === "/api/units" && request.method === "POST") {
        await ensureSchema(env);
        const body = await safeJson(request);
        const unit = await upsertUnit(env, body);
        return json({ ok: true, unit }, 200, corsHeaders);
      }

      if (pathname === "/api/ai-parse" && request.method === "POST") {
        const body = await safeJson(request);
        const parsed = await handleAiParse(env, body);
        return json(parsed, 200, corsHeaders);
      }

      const unitMatch = pathname.match(/^\/api\/units\/(\d+)$/);
      if (unitMatch && request.method === "PATCH") {
        await ensureSchema(env);
        const id = Number(unitMatch[1]);
        const body = await safeJson(request);
        const unit = await patchUnit(env, id, body);
        return json({ ok: true, unit }, 200, corsHeaders);
      }

      if (unitMatch && request.method === "DELETE") {
        await ensureSchema(env);
        const id = Number(unitMatch[1]);
        const unit = await getUnitById(env, id);
        if (!unit) {
          return json({ ok: true }, 200, corsHeaders);
        }

        await deleteUnit(env, id, unit);
        return json({ ok: true }, 200, corsHeaders);
      }

      return json({ ok: false, error: "not_found", path: pathname }, 404, corsHeaders);
    } catch (error) {
      console.error(error);
      return json({
        ok: false,
        error: "internal_error",
        message: error?.message || String(error)
      }, 500, corsHeaders);
    }
  }
};

function getCorsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://infochibafukushi-dotcom.github.io";
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

function normalizePath(pathname) {
  return pathname.replace(/\/+$/, "") || "/";
}

function validateEnv(env) {
  if (!env.DB) {
    throw new Error("Missing D1 binding: DB");
  }
}

function json(data, status = 200, corsHeaders = getCorsHeaders(new Request("https://dummy.local"))) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8"
    }
  });
}

async function safeJson(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function normalizeUnitTitle(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const collapsed = raw.replace(/[ 　]+/g, "");
  if (UNIT_ALIASES.has(collapsed)) return UNIT_ALIASES.get(collapsed);
  const canonical = CANONICAL_UNITS.find((name) => name.replace(/[ 　]+/g, "") === collapsed);
  return canonical || raw;
}

function unitOrder(title) {
  const normalized = normalizeUnitTitle(title);
  return UNIT_ORDER.has(normalized) ? UNIT_ORDER.get(normalized) : 9999;
}

async function ensureSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course TEXT NOT NULL,
        title TEXT NOT NULL,
        is_visible INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course TEXT NOT NULL,
        unit TEXT NOT NULL,
        type TEXT NOT NULL,
        question TEXT NOT NULL,
        choices_json TEXT NOT NULL DEFAULT '[]',
        answer_json TEXT NOT NULL DEFAULT '[]',
        answer TEXT NOT NULL DEFAULT '',
        blank_count INTEGER NOT NULL DEFAULT 1,
        explanation TEXT NOT NULL DEFAULT '',
        image_url TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
  ]);

  await ensureColumn(env, "units", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(env, "questions", "answer", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(env, "questions", "blank_count", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn(env, "questions", "explanation", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(env, "questions", "image_url", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(env, "questions", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(env, "questions", "created_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
  await ensureColumn(env, "questions", "updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
}

async function ensureColumn(env, table, column, definition) {
  const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  const exists = (result.results || []).some((row) => row.name === column);
  if (!exists) {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

async function initDb(env, mode = "replace") {
  await ensureSchema(env);

  if (mode === "replace") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM questions"),
      env.DB.prepare("DELETE FROM units")
    ]);
  }

  for (let i = 0; i < CANONICAL_UNITS.length; i += 1) {
    if (mode === "replace") {
      await env.DB.prepare(`
        INSERT INTO units (course, title, is_visible, sort_order, created_at, updated_at)
        VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(CANONICAL_COURSE_TITLE, CANONICAL_UNITS[i], i + 1).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO units (course, title, is_visible, sort_order, created_at, updated_at)
        SELECT ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        WHERE NOT EXISTS (
          SELECT 1 FROM units WHERE course = ? AND title = ?
        )
      `).bind(
        CANONICAL_COURSE_TITLE,
        CANONICAL_UNITS[i],
        i + 1,
        CANONICAL_COURSE_TITLE,
        CANONICAL_UNITS[i]
      ).run();
    }
  }
}

async function ensureCanonicalUnits(env) {
  const existing = await env.DB.prepare(
    "SELECT id, title FROM units WHERE course = ?"
  ).bind(CANONICAL_COURSE_TITLE).all();

  const rows = existing.results || [];
  const titles = new Set(rows.map((row) => normalizeUnitTitle(row.title)));

  for (let i = 0; i < CANONICAL_UNITS.length; i += 1) {
    const title = CANONICAL_UNITS[i];
    if (!titles.has(title)) {
      await env.DB.prepare(`
        INSERT INTO units (course, title, is_visible, sort_order, created_at, updated_at)
        VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(CANONICAL_COURSE_TITLE, title, i + 1).run();
    }
  }

  await normalizeExistingUnitNames(env);
}

async function normalizeExistingUnitNames(env) {
  const rows = await env.DB.prepare("SELECT id, title FROM units").all();
  for (const row of rows.results || []) {
    const normalized = normalizeUnitTitle(row.title);
    if (normalized && normalized !== row.title) {
      await env.DB.prepare(
        "UPDATE units SET title = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(normalized, unitOrder(normalized) + 1, row.id).run();
    }
  }

  const questionRows = await env.DB.prepare("SELECT id, unit FROM questions").all();
  for (const row of questionRows.results || []) {
    const normalized = normalizeUnitTitle(row.unit);
    if (normalized && normalized !== row.unit) {
      await env.DB.prepare(
        "UPDATE questions SET unit = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(normalized, row.id).run();
    }
  }
}

async function buildQuizJson(env) {
  const unitsResult = await env.DB.prepare(`
    SELECT id, course, title, is_visible, sort_order
    FROM units
    ORDER BY
      course,
      CASE title
        WHEN '人間の尊厳と自立' THEN 1
        WHEN '介護の基本' THEN 2
        WHEN 'コミュニケーション技術' THEN 3
        WHEN '社会の理解' THEN 4
        WHEN '認知症の理解' THEN 5
        WHEN '発達と老化の理解' THEN 6
        WHEN '障害の理解' THEN 7
        WHEN 'こころとからだのしくみ1' THEN 8
        WHEN 'こころとからだのしくみ2' THEN 9
        WHEN '介護過程1' THEN 10
        WHEN '介護過程2' THEN 11
        ELSE 999
      END,
      sort_order,
      id
  `).all();

  const questionsResult = await env.DB.prepare(`
    SELECT *
    FROM questions
    ORDER BY course, unit, sort_order, id
  `).all();

  const courses = [];
  const courseMap = new Map();
  const unitMap = new Map();

  function ensureCourse(courseTitle) {
    const title = String(courseTitle || CANONICAL_COURSE_TITLE);
    if (courseMap.has(title)) return courseMap.get(title);
    const course = {
      id: `course:${encodeId(title)}`,
      courseId: title,
      title,
      units: []
    };
    courseMap.set(title, course);
    courses.push(course);
    return course;
  }

  function ensureUnit(courseTitle, unitTitle, seed = null) {
    const normalizedUnit = normalizeUnitTitle(unitTitle);
    if (!normalizedUnit) return null;
    const key = `${courseTitle}::${normalizedUnit}`;
    if (unitMap.has(key)) return unitMap.get(key);

    const course = ensureCourse(courseTitle);
    const unit = {
      id: seed?.id ?? null,
      unitId: seed?.unitId ?? seed?.id ?? null,
      title: normalizedUnit,
      isVisible: seed?.isVisible ?? true,
      questions: []
    };
    unitMap.set(key, unit);
    course.units.push(unit);
    return unit;
  }

  for (const row of unitsResult.results || []) {
    const courseTitle = row.course || CANONICAL_COURSE_TITLE;
    ensureUnit(courseTitle, row.title, {
      id: row.id,
      unitId: row.id,
      isVisible: row.is_visible !== 0
    });
  }

  const canonicalCourse = ensureCourse(CANONICAL_COURSE_TITLE);
  for (const title of CANONICAL_UNITS) {
    ensureUnit(canonicalCourse.title, title, { isVisible: true });
  }

  for (const row of questionsResult.results || []) {
    const courseTitle = row.course || CANONICAL_COURSE_TITLE;
    const unitTitle = normalizeUnitTitle(row.unit);
    const unit = ensureUnit(courseTitle, unitTitle, { isVisible: true });
    if (!unit) continue;
    unit.questions.push(formatQuestion(row, unit));
  }

  for (const course of courses) {
    course.units.sort((a, b) => {
      const diff = unitOrder(a.title) - unitOrder(b.title);
      return diff !== 0 ? diff : String(a.title).localeCompare(String(b.title), "ja");
    });
  }

  courses.sort((a, b) => String(a.title).localeCompare(String(b.title), "ja"));

  return {
    appTitle: "カイゴクイズ",
    courses
  };
}

function formatQuestion(row, unit) {
  const choices = parseArray(row.choices_json);
  const answers = parseArray(row.answer_json);
  const singleAnswer = row.answer || (answers.length === 1 ? answers[0] : "");

  return {
    id: row.id,
    courseId: row.course || CANONICAL_COURSE_TITLE,
    unitId: unit?.id ?? unit?.unitId ?? null,
    type: row.type || "fill",
    question: row.question || "",
    explanation: row.explanation || "",
    choices,
    answer: singleAnswer,
    answers,
    blankCount: Number(row.blank_count) > 0 ? Number(row.blank_count) : Math.max(1, answers.length || 1),
    imageData: row.image_url || "",
    imageUrl: row.image_url || ""
  };
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value)
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function normalizeChoiceAnswer(answer, choices) {
  const normalizedChoices = Array.isArray(choices) ? choices.map((c) => String(c || "").trim()) : [];
  if (!answer) return "";

  const directIndex = normalizedChoices.findIndex((c) => c && c === answer);
  if (directIndex >= 0) return String(directIndex + 1);

  const digitMap = { "①": 1, "②": 2, "③": 3, "④": 4, "１": 1, "２": 2, "３": 3, "４": 4 };
  const compact = String(answer).replace(/\s+/g, "");
  const mapped = digitMap[compact];
  if (mapped && normalizedChoices[mapped - 1]) return String(mapped);

  const m = String(answer).match(/[1-4１-４①-④]/);
  if (m) {
    const token = m[0];
    const idx = digitMap[token] || Number(token);
    if (idx >= 1 && idx <= normalizedChoices.length) return String(idx);
  }

  const includes = normalizedChoices
    .map((choice, idx) => ({ choice, idx }))
    .filter((item) => item.choice && String(answer).includes(item.choice));
  if (includes.length === 1) return String(includes[0].idx + 1);

  return "";
}

async function normalizeQuestionPayload(env, payload) {
  const type = String(payload?.type || "fill").trim();
  const questionText = String(payload?.question || "").trim();
  if (!questionText) {
    throw new Error("問題文が空です");
  }

  const choices = Array.isArray(payload?.choices) ? payload.choices.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  let answers = Array.isArray(payload?.answers) ? payload.answers.map((x) => String(x ?? "").trim()).filter((v) => v) : [];

  let answer = String(payload?.answer ?? "").trim();
  if (type === "choice") {
    const normalizedFromAnswer = normalizeChoiceAnswer(answer, choices);
    const normalizedFromAnswers = answers
      .map((v) => normalizeChoiceAnswer(String(v || "").trim(), choices))
      .find(Boolean) || "";
    answer = normalizedFromAnswer || normalizedFromAnswers;
  }

  if (answer && answers.length === 0 && (type === "choice" || type === "ox" || type === "fill")) {
    answers.push(answer);
  }

  const course = String(payload?.course || payload?.courseId || CANONICAL_COURSE_TITLE).trim() || CANONICAL_COURSE_TITLE;
  const unit = await resolveUnitTitle(env, payload);

  if (!unit) {
    throw new Error("保存先単元が空です");
  }

  const blankCount = Math.max(1, Number(payload?.blankCount) || Math.max(answers.length, 1));
  const image = String(payload?.imageData || payload?.imageUrl || payload?.image || "").trim();

  return {
    type,
    question: questionText,
    choices,
    answers,
    answer: answer || (answers.length === 1 ? answers[0] : ""),
    course,
    unit,
    blankCount,
    explanation: String(payload?.explanation || "").trim(),
    image
  };
}


async function resolveUnitTitle(env, payload) {
  const fromText = normalizeUnitTitle(payload?.unit || payload?.unitTitle || "");
  if (fromText) return fromText;

  const rawUnitId = payload?.unitId;
  if (rawUnitId === undefined || rawUnitId === null || rawUnitId === "") return "";

  const unitId = Number(rawUnitId);
  if (!Number.isFinite(unitId) || unitId <= 0) {
    return normalizeUnitTitle(String(rawUnitId));
  }

  const row = await env.DB.prepare("SELECT title FROM units WHERE id = ? LIMIT 1").bind(unitId).first();
  if (!row?.title) return "";
  return normalizeUnitTitle(row.title);
}

async function createQuestion(env, payload) {
  const data = await normalizeQuestionPayload(env, payload);
  await ensureCanonicalUnits(env);
  await ensureUnitExists(env, data.course, data.unit);

  const maxSort = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM questions WHERE course = ? AND unit = ?"
  ).bind(data.course, data.unit).first();

  const result = await env.DB.prepare(`
    INSERT INTO questions (
      course,
      unit,
      type,
      question,
      choices_json,
      answer_json,
      answer,
      blank_count,
      explanation,
      image_url,
      sort_order,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    data.course,
    data.unit,
    data.type,
    data.question,
    JSON.stringify(data.choices),
    JSON.stringify(data.answers),
    data.answer,
    data.blankCount,
    data.explanation,
    data.image,
    Number(maxSort?.max_sort || 0) + 1
  ).run();

  const id = result.meta?.last_row_id;
  return await getQuestionById(env, id);
}

async function updateQuestion(env, id, payload) {
  const data = await normalizeQuestionPayload(env, { ...payload, id });
  await ensureCanonicalUnits(env);
  await ensureUnitExists(env, data.course, data.unit);

  await env.DB.prepare(`
    UPDATE questions
    SET
      course = ?,
      unit = ?,
      type = ?,
      question = ?,
      choices_json = ?,
      answer_json = ?,
      answer = ?,
      blank_count = ?,
      explanation = ?,
      image_url = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    data.course,
    data.unit,
    data.type,
    data.question,
    JSON.stringify(data.choices),
    JSON.stringify(data.answers),
    data.answer,
    data.blankCount,
    data.explanation,
    data.image,
    id
  ).run();

  return await getQuestionById(env, id);
}

async function getQuestionById(env, id) {
  if (!id) return null;
  const row = await env.DB.prepare("SELECT * FROM questions WHERE id = ?").bind(id).first();
  if (!row) return null;
  return formatQuestion(row, { id: null, unitId: null });
}

async function ensureUnitExists(env, course, title) {
  const normalizedTitle = normalizeUnitTitle(title);
  const row = await env.DB.prepare(
    "SELECT id FROM units WHERE course = ? AND title = ? LIMIT 1"
  ).bind(course, normalizedTitle).first();

  if (row?.id) return row.id;

  const result = await env.DB.prepare(`
    INSERT INTO units (course, title, is_visible, sort_order, created_at, updated_at)
    VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(course, normalizedTitle, unitOrder(normalizedTitle) + 1).run();

  return result.meta?.last_row_id;
}

async function upsertUnit(env, payload) {
  const course = String(payload?.course || payload?.courseId || CANONICAL_COURSE_TITLE).trim() || CANONICAL_COURSE_TITLE;
  const title = normalizeUnitTitle(payload?.title || payload?.unit || payload?.unitTitle || "");
  if (!title) throw new Error("単元名が空です");

  const id = await ensureUnitExists(env, course, title);
  return await getUnitById(env, id);
}

async function patchUnit(env, id, payload) {
  const current = await getUnitById(env, id);
  if (!current) throw new Error("単元が見つかりません");

  const title = payload?.title !== undefined ? normalizeUnitTitle(payload.title) : current.title;
  const isVisible = payload?.isVisible !== undefined
    ? (payload.isVisible ? 1 : 0)
    : (current.isVisible ? 1 : 0);

  await env.DB.prepare(`
    UPDATE units
    SET title = ?, is_visible = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(title, isVisible, unitOrder(title) + 1, id).run();

  return await getUnitById(env, id);
}

async function deleteUnit(env, id, unit = null) {
  const currentUnit = unit || await getUnitById(env, id);
  if (!currentUnit) return;

  await env.DB.batch([
    env.DB.prepare("DELETE FROM questions WHERE course = ? AND unit = ?")
      .bind(currentUnit.courseId, currentUnit.title),
    env.DB.prepare("DELETE FROM units WHERE id = ?").bind(id)
  ]);
}

async function getUnitById(env, id) {
  const row = await env.DB.prepare(
    "SELECT id, course, title, is_visible FROM units WHERE id = ?"
  ).bind(id).first();

  if (!row) return null;

  return {
    id: row.id,
    unitId: row.id,
    courseId: row.course,
    title: normalizeUnitTitle(row.title),
    isVisible: row.is_visible !== 0
  };
}

function encodeId(value) {
  try {
    return btoa(unescape(encodeURIComponent(String(value)))).replace(/=+$/g, "");
  } catch {
    return String(value).replace(/[^\w-]+/g, "_");
  }
}

const ALLOWED_TYPES = new Set(["choice", "ox", "multi", "fill", "fill_multi", "combo", "case"]);

function normalizeForAudit(value) {
  return String(value ?? "")
    .replace(/\r/g, "\n")
    .replace(/[ \t　]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function collectMutationIssues(rawText, answerText, questions) {
  const issues = [];
  const questionHay = normalizeForAudit(rawText);
  const answerHay = normalizeForAudit(answerText);
  (questions || []).forEach((q, qi) => {
    const questionNeedle = normalizeForAudit(q?.question);
    if (questionNeedle && !questionHay.includes(questionNeedle)) issues.push(`q${qi + 1}.question not found in rawText`);
    const answerNeedle = normalizeForAudit(q?.answer);
    if (answerNeedle && !answerHay.includes(answerNeedle)) issues.push(`q${qi + 1}.answer not found in answerText`);
    (Array.isArray(q?.choices) ? q.choices : []).forEach((value, ci) => {
      const needle = normalizeForAudit(value);
      if (!needle) return;
      if (!questionHay.includes(needle)) issues.push(`q${qi + 1}.choices[${ci}] not found in rawText`);
    });
    (Array.isArray(q?.answers) ? q.answers : []).forEach((value, ai) => {
      const needle = normalizeForAudit(value);
      if (!needle) return;
      if (!answerHay.includes(needle)) issues.push(`q${qi + 1}.answers[${ai}] not found in answerText`);
    });
  });
  return issues;
}

function countFillBlanks(question) {
  return (String(question || "").match(/（　　　）/g) || []).length;
}

function normalizeAiQuestions(questions) {
  return (Array.isArray(questions) ? questions : []).map((q) => {
    const type = String(q?.type || "");
    const normalized = {
      ...q,
      question: String(q?.question || ""),
      answers: Array.isArray(q?.answers) ? q.answers.map((v) => String(v ?? "")) : [],
      answer: String(q?.answer || "")
    };

    if (type !== "fill" && type !== "fill_multi") return normalized;

    const answerPool = [];
    if (normalized.answer) answerPool.push(normalized.answer);
    normalized.answers.forEach((value) => {
      if (value) answerPool.push(value);
    });

    let patchedQuestion = normalized.question;
    answerPool
      .filter((value) => value.length > 0)
      .sort((a, b) => b.length - a.length)
      .forEach((value) => {
        patchedQuestion = patchedQuestion.split(value).join("（　　　）");
      });
    normalized.question = patchedQuestion;

    const blankCount = Math.max(1, countFillBlanks(normalized.question));
    normalized.blankCount = blankCount;
    normalized.answers = normalized.answers.slice(0, blankCount);
    while (normalized.answers.length < blankCount) normalized.answers.push("");
    normalized.answer = normalized.answers[0] || "";

    return normalized;
  });
}

function pickParseSourceText(rawText, answerText) {
  const raw = String(rawText || "");
  const answer = String(answerText || "");
  return raw.trim() ? raw : answer;
}

function getTagBody(block, tagName) {
  const m = block.match(new RegExp(`\\[${tagName}\\]\\s*([\\s\\S]*?)(?=\\n\\[[A-Z_]+(?::[^\\]]+)?\\]|$)`, "i"));
  return m ? m[1].trim() : "";
}

function parsePipeList(text) {
  return String(text || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIndexedLines(sectionText) {
  const lines = String(sectionText || "").split(/\r?\n/);
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^\s*\d+\s*\|\s*(.+)\s*$/);
      return m ? m[1].trim() : "";
    })
    .filter(Boolean);
}

function parseDeterministicDx(unitTitle, rawText, answerText) {
  const sourceText = pickParseSourceText(rawText, answerText);
  const blockPattern = /^\[(?:TYPE:[^\]]+|CASE)\][\s\S]*?(?=^\[(?:TYPE:[^\]]+|CASE)\]|(?![\s\S]))/gm;
  const blocks = (sourceText.match(blockPattern) || [])
    .map((b) => b.trim())
    .filter(Boolean);
  const caseMap = new Map();
  const questions = [];
  const issues = [];

  for (const block of blocks) {
    if (/^\[CASE\]/m.test(block)) {
      const caseIdMatch = block.match(/^\[CASE_ID:([^\]]+)\]\s*$/m);
      const caseId = caseIdMatch ? caseIdMatch[1].trim() : "";
      const caseBody = block
        .replace(/^\[CASE\]\s*$/m, "")
        .replace(/^\[CASE_ID:[^\]]+\]\s*$/m, "")
        .trim();
      if (caseId) caseMap.set(caseId, caseBody);
      continue;
    }

    const typeMatch = block.match(/^\[TYPE:([a-z_]+)\]\s*$/im);
    const qidMatch = block.match(/^\[QID:([^\]]+)\]\s*$/im);
    if (!typeMatch || !qidMatch) continue;

    const type = typeMatch[1].trim();
    const qid = qidMatch[1].trim();
    const caseRefMatch = block.match(/^\[CASE_REF:([^\]]+)\]\s*$/im);
    const caseRef = caseRefMatch ? caseRefMatch[1].trim() : "";
    const baseQuestion = getTagBody(block, "問題文:");
    const casePrefix = caseRef && caseMap.has(caseRef) ? `${caseMap.get(caseRef)}\n\n` : "";
    const question = `${casePrefix}${baseQuestion}`.trim();
    const answerRaw = getTagBody(block, "ANSWER");
    const answerList = parsePipeList(answerRaw);

    const item = { id: qid, type, question, choices: [], answer: "", answers: [], blankCount: 1 };
    if (type === "fill") {
      item.answers = answerList;
      item.answer = answerList[0] || "";
      item.blankCount = Math.max(1, countFillBlanks(question), item.answers.length || 1);
    } else if (type === "fill_multi") {
      item.answers = answerList;
      item.blankCount = Math.max(countFillBlanks(question), item.answers.length);
      item.answer = item.answers[0] || "";
    } else if (type === "choice") {
      item.choices = parseIndexedLines(getTagBody(block, "CHOICES"));
      item.answer = answerList[0] || "";
      item.answers = item.answer ? [item.answer] : [];
    } else if (type === "multi") {
      item.choices = parseIndexedLines(getTagBody(block, "CHOICES"));
      item.answers = answerList;
      item.answer = "";
    } else if (type === "ox") {
      item.choices = parseIndexedLines(getTagBody(block, "ITEMS"));
      item.answers = String(answerRaw || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const m = line.match(/^\s*\d+\s*\|\s*(.+)\s*$/);
          return m ? m[1].trim() : "";
        })
        .filter(Boolean);
      item.answer = "";
      item.blankCount = item.answers.length;
    } else {
      issues.push(`qid:${qid}.type unsupported`);
    }
    questions.push(item);
  }
  return { unitTitle, questions, issues };
}

async function handleAiParse(env, body) {
  const unitTitle = normalizeUnitTitle(body?.unitTitle || "");
  const rawText = String(body?.rawText || "");
  const answerText = String(body?.answerText || "");
  if (!unitTitle) return { ok: false, error: "invalid_request", message: "unitTitle is required" };
  if (!rawText.trim() && !answerText.trim()) return { ok: false, error: "invalid_request", message: "rawText or answerText is required" };

  const parsed = parseDeterministicDx(unitTitle, rawText, answerText);
  const normalizedQuestions = normalizeAiQuestions(parsed?.questions);
  const issues = Array.isArray(parsed?.issues) ? [...parsed.issues] : [];
  const questions = [];
  normalizedQuestions.forEach((q, i) => {
    const type = String(q?.type || "");
    const questionText = String(q?.question || "");
    if (!ALLOWED_TYPES.has(type)) issues.push(`q${i + 1}.type invalid`);
    if (type === "case" && !/(次の事例|利用者|事例|状況説明)/.test(questionText)) {
      issues.push(`q${i + 1}.invalid_case`);
    }
    if (type === "fill" || type === "fill_multi") {
      const hasAnswer = String(q?.answer || "").trim() !== "";
      const hasAnswers = (Array.isArray(q?.answers) ? q.answers : []).some((v) => String(v || "").trim() !== "");
      if (!hasAnswer && !hasAnswers) {
        issues.push(`q${i + 1}.answer_unknown_skipped`);
        return;
      }
      if (!hasAnswers) issues.push(`q${i + 1}.answer_unknown`);
    }
    questions.push(q);
  });
  const auditIssues = collectMutationIssues(rawText, answerText, questions);
  const blockingIssues = issues.filter(issue =>
    !issue.includes("not found in rawText") &&
    !issue.includes("rawTextに解答") &&
    !issue.includes("answer_unknown") &&
    !issue.includes("invalid_case")
  );

  return {
    ok: blockingIssues.length === 0,
    unitTitle,
    questions,
    issues: blockingIssues,
    auditIssues
  };
}
