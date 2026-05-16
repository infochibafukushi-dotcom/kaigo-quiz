const API_BASE = window.KAIGO_QUIZ_API_BASE || "https://kaigo-quiz-save.info-chibafukushi.workers.dev";

let db = { appTitle: "カイゴクイズ", courses: [] };
let courseIndex = 0;
let unitIndex = 0;
let questionIndex = 0;
let saving = false;
let deleting = false;
let editingQuestionId = null;

const app = document.getElementById("app");

const TYPES = ["choice", "ox", "multi", "fill", "fill_multi", "image_fill"];

const TLABEL = {
  choice: "4択",
  ox: "○×",
  multi: "複数選択",
  fill: "記述",
  fill_multi: "空欄補充",
  image_fill: "画像穴埋め"
};

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

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function norm(value) {
  return String(value ?? "").trim();
}

function normalizeUnitTitle(value) {
  const raw = norm(value);
  if (!raw) return "";
  const collapsed = raw.replace(/[ 　]+/g, "");
  if (UNIT_ALIASES.has(collapsed)) return UNIT_ALIASES.get(collapsed);
  const canonical = CANONICAL_UNITS.find((name) => name.replace(/[ 　]+/g, "") === collapsed);
  return canonical || raw;
}

function isMultiBlankType(type) {
  return type === "fill_multi" || type === "image_fill";
}

function canonicalUnitSortValue(title) {
  const normalized = normalizeUnitTitle(title);
  return UNIT_ORDER.has(normalized) ? UNIT_ORDER.get(normalized) : Number.MAX_SAFE_INTEGER;
}

function sortUnitsByCanonicalOrder(units = []) {
  return [...units].sort((a, b) => {
    const ao = canonicalUnitSortValue(a?.title);
    const bo = canonicalUnitSortValue(b?.title);
    if (ao !== bo) return ao - bo;
    return String(a?.title || "").localeCompare(String(b?.title || ""), "ja");
  });
}

function normalizeQuestion(rawQuestion = {}, courseId = null, unitId = null) {
  const question = {
    id: rawQuestion.id,
    courseId: rawQuestion.courseId ?? courseId ?? null,
    unitId: rawQuestion.unitId ?? unitId ?? null,
    type: rawQuestion.type || "fill",
    question: rawQuestion.question || "",
    explanation: rawQuestion.explanation || "",
    choices: Array.isArray(rawQuestion.choices) ? rawQuestion.choices : [],
    answer: rawQuestion.answer ?? "",
    answers: Array.isArray(rawQuestion.answers) ? rawQuestion.answers : [],
    blankCount: Number(rawQuestion.blankCount) > 0
      ? Number(rawQuestion.blankCount)
      : ((Array.isArray(rawQuestion.answers) && rawQuestion.answers.length) || 1),
    imageData: rawQuestion.imageData || rawQuestion.image || rawQuestion.imageUrl || ""
  };

  if (isMultiBlankType(question.type)) {
    question.blankCount = Math.max(1, Math.min(20, Number(question.blankCount) || 1));
    while (question.answers.length < question.blankCount) question.answers.push("");
    question.answers = question.answers.slice(0, question.blankCount);
  }

  return question;
}

function normalizeDatabase(rawData) {
  const rawCourses = Array.isArray(rawData?.courses) ? rawData.courses : [];

  let courses = rawCourses.map((course) => {
    const courseId = course?.courseId ?? course?.id ?? null;
    const courseAliasId = course?.id ?? course?.courseId ?? null;
    const units = sortUnitsByCanonicalOrder(Array.isArray(course?.units) ? course.units : []);

    return {
      id: courseAliasId === "" ? null : courseAliasId,
      courseId: courseId === "" ? null : courseId,
      title: course?.title || CANONICAL_COURSE_TITLE,
      units: units.map((unit) => {
        const normalizedTitle = normalizeUnitTitle(unit?.title || "");
        const unitId = unit?.unitId ?? unit?.id ?? null;
        const unitAliasId = unit?.id ?? unit?.unitId ?? null;
        const questions = Array.isArray(unit?.questions)
          ? unit.questions.map((question) => normalizeQuestion(question, courseId, unitId))
          : [];

        return {
          id: unitAliasId === "" ? null : unitAliasId,
          unitId: unitId === "" ? null : unitId,
          title: normalizedTitle || unit?.title || "",
          isVisible: unit?.isVisible !== false,
          questions
        };
      })
    };
  });

  if (courses.length === 0) {
    courses = [{
      id: null,
      courseId: null,
      title: CANONICAL_COURSE_TITLE,
      units: []
    }];
  }

  courses.forEach((course) => {
    const merged = new Map();

    (course.units || []).forEach((unit) => {
      const title = normalizeUnitTitle(unit.title);
      if (!title) return;
      if (!merged.has(title)) {
        merged.set(title, { ...unit, title, questions: Array.isArray(unit.questions) ? unit.questions : [] });
      } else {
        const existing = merged.get(title);
        existing.questions = [...(existing.questions || []), ...(unit.questions || [])];
        existing.id = existing.id || unit.id;
        existing.unitId = existing.unitId || unit.unitId;
        existing.isVisible = existing.isVisible !== false || unit.isVisible !== false;
      }
    });

    CANONICAL_UNITS.forEach((title) => {
      if (!merged.has(title)) {
        merged.set(title, {
          id: null,
          unitId: null,
          title,
          isVisible: true,
          questions: []
        });
      }
    });

    course.units = sortUnitsByCanonicalOrder([...merged.values()]);
  });

  return {
    appTitle: rawData?.appTitle || "カイゴクイズ",
    courses
  };
}

function getAnswersForMultiBlank(question) {
  const blankCount = Math.max(1, Number(question.blankCount) || 1);
  const answers = Array.isArray(question.answers) ? question.answers.slice() : [];
  while (answers.length < blankCount) answers.push("");
  return answers.slice(0, blankCount);
}

async function api(path, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, init);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof body === "string"
      ? body
      : (body?.message || body?.error || `${response.status} ${response.statusText}`);
    throw new Error(message);
  }

  return body;
}

async function loadData(admin = false) {
  const raw = await api(`/api/questions${admin ? "?admin=1" : ""}`);
  db = normalizeDatabase(raw);
  courseIndex = clampIndex(courseIndex, db.courses.length);
  unitIndex = clampIndex(unitIndex, db.courses[courseIndex]?.units?.length || 0);
  questionIndex = clampIndex(questionIndex, curUnit()?.questions?.length || 0);
}

function clampIndex(value, length) {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) return 0;
  if (!length || length <= 0) return 0;
  return Math.min(Number(value), length - 1);
}

function curCourse() {
  return db.courses[courseIndex] || null;
}

function curUnit() {
  return curCourse()?.units?.[unitIndex] || null;
}

function curQuestion() {
  return curUnit()?.questions?.[questionIndex] || null;
}

function renderHome() {
  let html = `
    <div class="topbar">
      <div class="topbar-left"><h1>${esc(db.appTitle)}</h1></div>
      <div class="topbar-right"><button class="secondary" data-act="open-admin">⚙ 管理</button></div>
    </div>
    <div class="card">
      <p>科目を選択してください。</p>
    </div>
  `;

  db.courses.forEach((course, ci) => {
    html += `
      <div class="card unit-card" data-act="open-course" data-ci="${ci}">
        <div>📚 ${esc(course.title)}</div>
        <div>›</div>
      </div>
    `;
  });

  app.innerHTML = html;
}

function renderUnits(ci = 0) {
  courseIndex = clampIndex(ci, db.courses.length);
  unitIndex = clampIndex(unitIndex, curCourse()?.units?.length || 0);
  const course = curCourse();

  let html = `
    <div class="topbar">
      <div class="topbar-left"><button class="secondary" data-act="home">戻る</button></div>
      <div class="topbar-right"><button class="secondary" data-act="open-admin">⚙ 管理</button></div>
    </div>
    <div class="card">
      <h2>${esc(course?.title || "")}</h2>
    </div>
  `;

  const visibleUnits = (course?.units || []).filter((unit) => unit.isVisible !== false);

  if (visibleUnits.length === 0) {
    html += `<div class="card"><p>表示中の単元がありません。</p></div>`;
  }

  (course?.units || []).forEach((unit, ui) => {
    if (unit.isVisible === false) return;
    html += `
      <div class="card unit-card" data-act="start-quiz" data-ci="${courseIndex}" data-ui="${ui}">
        <div>${esc(unit.title)}</div>
        <div class="sub">${(unit.questions || []).length}問 ›</div>
      </div>
    `;
  });

  app.innerHTML = html;
}

function renderQuestion() {
  const unit = curUnit();
  const question = curQuestion();

  if (!unit || !question) {
    renderUnits(courseIndex);
    return;
  }

  let html = `
    <div class="topbar">
      <div class="topbar-left"><button class="secondary" data-act="back-units">単元へ</button></div>
    </div>
    <div class="card">
      <h3>${esc(unit.title)} ${questionIndex + 1}/${unit.questions.length}</h3>
  `;

  if (question.imageData) {
    html += `<img class="quiz-image" src="${esc(question.imageData)}" alt="">`;
  }

  html += `<p>${esc(question.question)}</p>`;

  if (question.type === "ox") {
    html += `
      <button data-act="ans-single" data-v="○">○</button>
      <button data-act="ans-single" data-v="×">×</button>
    `;
  } else if (question.type === "choice") {
    (question.choices || []).forEach((choice) => {
      html += `<button data-act="ans-single" data-v="${esc(choice)}">${esc(choice)}</button>`;
    });
  } else if (question.type === "multi") {
    (question.choices || []).forEach((choice) => {
      html += `
        <label>
          <input type="checkbox" class="multi-answer" value="${esc(choice)}">
          ${esc(choice)}
        </label>
      `;
    });
    html += `<button data-act="ans-multi">回答</button>`;
  } else if (question.type === "fill") {
    html += `
      <input id="answerInput" autocomplete="off">
      <button data-act="ans-fill">回答</button>
    `;
  } else {
    const blankCount = Math.max(1, Number(question.blankCount) || 1);
    for (let i = 0; i < blankCount; i += 1) {
html += `
  <div class="blank-row">
    <input class="blank-input" placeholder="アンサー${i + 1}" autocomplete="off">
    <div class="blank-result" data-blank-result="${i}"></div>
  </div>
`;
    }
    html += `<button data-act="ans-fill-multi">回答</button>`;
  }

  html += `<div id="result"></div></div>`;
  app.innerHTML = html;
}

function judge(ok, expectedText) {
  const result = document.getElementById("result");
  if (!result) return;

  result.innerHTML = `
    <p class="${ok ? "result-ok" : "result-ng"}">${ok ? "✅正解" : "❌不正解"}</p>
    <p>正解: ${esc(expectedText)}</p>
    <button data-act="next-q">次へ</button>
  `;
}

function renderAdmin() {
  if (!db.courses.length) {
    db = normalizeDatabase(db);
  }

  courseIndex = clampIndex(courseIndex, db.courses.length);
  unitIndex = clampIndex(unitIndex, curCourse()?.units?.length || 0);

  const course = curCourse();
  const unit = curUnit();

  let html = `
    <div class="topbar">
      <div class="topbar-left"><button class="secondary" data-act="home">TOP</button></div>
      <div class="topbar-right"><button data-act="save-all">保存</button></div>
    </div>

    <div class="card">
      <h3>管理画面</h3>

      <label>
        科目
        <select id="adminCourse">
  `;

  db.courses.forEach((item, index) => {
    html += `<option value="${index}" ${index === courseIndex ? "selected" : ""}>${esc(item.title)}</option>`;
  });

  html += `
        </select>
      </label>

      <div class="actions">
        <button data-act="add-course">科目追加</button>
        <button data-act="ren-course">科目名変更</button>
        <button class="danger" data-act="del-course">科目削除</button>
      </div>

      <label>
        単元
        <select id="adminUnit">
  `;

  (course?.units || []).forEach((item, index) => {
    html += `
      <option value="${index}" ${index === unitIndex ? "selected" : ""}>
        ${esc(item.title)} ${item.isVisible === false ? "(非表示)" : ""}
      </option>
    `;
  });

  html += `
        </select>
      </label>

      <div class="actions">
        <button data-act="add-unit">単元追加</button>
        <button data-act="ren-unit">単元名変更</button>
        <button data-act="toggle-unit">表示/非表示</button>
        <button class="danger" data-act="del-unit">単元削除</button>
      </div>

      <div class="actions">
        <button data-act="add-q">問題追加</button>
        <button data-act="export-json">JSON出力</button>
        <label class="secondary">
          JSON読込
          <input type="file" id="importJson" accept="application/json">
        </label>
      </div>
    </div>

    <div class="card">
      <h4>問題一覧：${esc(unit?.title || "")}</h4>
  `;

  const questions = Array.isArray(unit?.questions) ? unit.questions : [];

  if (questions.length === 0) {
    html += `<p class="sub">この単元にはまだ問題がありません。</p>`;
  }

  questions.forEach((question, index) => {
    html += `
      <div class="card">
        <div>${index + 1}. [${esc(TLABEL[question.type] || question.type)}] ${esc((question.question || "").slice(0, 80))}</div>
        <div class="actions">
          <button class="small secondary" data-act="up-q" data-qi="${index}">↑</button>
          <button class="small secondary" data-act="down-q" data-qi="${index}">↓</button>
          <button class="small" data-act="edit-q" data-qi="${index}">編集</button>
          <button class="small danger" data-act="del-q" data-qi="${index}">削除</button>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  app.innerHTML = html;
}

function typeFields(question) {
  let html = `
    <label>
      問題文
      <textarea id="eq-question">${esc(question.question || "")}</textarea>
    </label>

    <label>
      解説
      <textarea id="eq-exp">${esc(question.explanation || "")}</textarea>
    </label>

    <label>
      画像
      <input type="file" id="eq-image-file" accept="image/*">
    </label>

    <div id="img-preview">
      ${question.imageData ? `<img class="quiz-image" src="${esc(question.imageData)}" alt="">` : ""}
    </div>

    <button type="button" class="secondary" data-act="img-clear">画像削除</button>
  `;

  if (question.type === "ox") {
    html += `
      <label>
        正解
        <select id="eq-answer">
          <option value="○" ${question.answer === "○" ? "selected" : ""}>○</option>
          <option value="×" ${question.answer === "×" ? "selected" : ""}>×</option>
        </select>
      </label>
    `;
  }

  if (question.type === "choice" || question.type === "multi") {
    html += `
      <label>
        選択肢（改行区切り）
        <textarea id="eq-choices">${esc((question.choices || []).join("\n"))}</textarea>
      </label>
    `;
  }

  if (question.type === "choice" || question.type === "fill") {
    html += `
      <label>
        正解
        <input id="eq-answer" value="${esc(question.answer || "")}">
      </label>
    `;
  }

  if (question.type === "multi") {
    html += `
      <label>
        正解（改行区切り）
        <textarea id="eq-answers-text">${esc((question.answers || []).join("\n"))}</textarea>
      </label>
    `;
  }

  if (isMultiBlankType(question.type)) {
    const blankCount = Math.max(1, Math.min(20, Number(question.blankCount) || 1));
    html += `
      <label>
        blankCount
        <input id="eq-blankCount" type="number" min="1" max="20" value="${blankCount}">
      </label>
      <div id="eq-answers">
    `;

    getAnswersForMultiBlank({ ...question, blankCount }).forEach((answer, index) => {
      html += `
        <label>
          アンサー${index + 1}
          <input class="edit-answer" value="${esc(answer || "")}">
        </label>
      `;
    });

    html += `</div>`;
  }

  return html;
}

function renderQuestionTypeSelector() {
  app.innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><button data-act="admin-back">戻る</button></div>
    </div>
    <div class="card">
      <h3>問題タイプを選択</h3>
      ${TYPES.map((type) => `<button data-act="pick-type" data-type="${type}">${esc(TLABEL[type])}</button>`).join("")}
    </div>
    <div class="card" id="live-editor">
      <p class="sub">タイプ選択で入力UIを表示します。</p>
    </div>
  `;
}

function renderEditQuestion(qi) {
  const unit = curUnit();
  const question = unit?.questions?.[qi];

  if (!question) {
    alert("編集対象の問題が見つかりません。");
    renderAdmin();
    return;
  }

  editingQuestionId = question.id ?? null;

  app.innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><button data-act="admin-back">戻る</button></div>
    </div>
    <div class="card">
      <h3>${esc(curCourse()?.title || "")} / ${esc(unit.title)} / ${esc(TLABEL[question.type] || question.type)}</h3>
      ${typeFields(question)}
      <button data-act="save-q" data-qi="${qi}">保存</button>
    </div>
  `;
}

function renderCreateForType(type) {
  editingQuestionId = null;
  const question = normalizeQuestion({ type, blankCount: 1 });

  app.innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><button data-act="admin-back">戻る</button></div>
    </div>
    <div class="card">
      <h3>新規問題: ${esc(TLABEL[type] || type)}</h3>
      ${typeFields(question)}
      <button data-act="create-q" data-type="${type}">保存</button>
    </div>
  `;
}

function isPreviewImageSrc(value) {
  const src = String(value || "").trim().toLowerCase();
  return src.startsWith("blob:") || src.startsWith("data:") || src.startsWith("object:");
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("画像の読み込みに失敗しました。"));
    reader.readAsDataURL(file);
  });
}

function syncPreviewToQuestion(question) {
  const img = document.querySelector("#img-preview img");
  const src = img ? String(img.getAttribute("src") || "").trim() : "";

  if (!src) {
    question.imageData = "";
    return;
  }

  if (isPreviewImageSrc(src)) return;
  question.imageData = src;
}

async function applyEditorToQuestion(question) {
  question.question = norm(document.getElementById("eq-question")?.value);
  question.explanation = norm(document.getElementById("eq-exp")?.value);
  question.imageData = question.imageData || "";

  syncPreviewToQuestion(question);

  const imageInput = document.getElementById("eq-image-file");
  const selectedImage = imageInput?.files?.[0];

  if (selectedImage) {
    question.imageData = await readFileAsDataURL(selectedImage);
  }

  if (question.type === "ox" || question.type === "choice" || question.type === "fill") {
    question.answer = norm(document.getElementById("eq-answer")?.value);
  }

  if (question.type === "choice" || question.type === "multi") {
    question.choices = (document.getElementById("eq-choices")?.value || "")
      .split("\n")
      .map(norm)
      .filter(Boolean);
  }

  if (question.type === "multi") {
    question.answers = (document.getElementById("eq-answers-text")?.value || "")
      .split("\n")
      .map(norm)
      .filter(Boolean);
  }

  if (isMultiBlankType(question.type)) {
    question.blankCount = Math.max(1, Math.min(20, Number(document.getElementById("eq-blankCount")?.value) || 1));
    question.answers = [...document.querySelectorAll(".edit-answer")]
      .map((input) => norm(input.value))
      .slice(0, question.blankCount);

    while (question.answers.length < question.blankCount) {
      question.answers.push("");
    }

    if (question.answers.length !== question.blankCount) {
      throw new Error("blankCount mismatch");
    }
  }
}

function buildQuestionPayload(question, context = {}) {
  const rawImage = String(question.imageData || "").trim();
  const payload = {
    id: question.id,
    type: norm(question.type || "fill"),
    question: norm(question.question),
    choices: Array.isArray(question.choices) ? question.choices.map(norm).filter(Boolean) : [],
    answers: Array.isArray(question.answers) ? question.answers.map(norm) : [],
    answer: norm(question.answer),
    explanation: norm(question.explanation),
    imageUrl: rawImage,
    imageData: rawImage,
    blankCount: Math.max(1, Number(question.blankCount) || 1)
  };

 const courseId = context.courseId ?? question.courseId;
const unitId = context.unitId ?? question.unitId;

  if (courseId !== undefined && courseId !== null && courseId !== "") payload.courseId = courseId;
  if (unitId !== undefined && unitId !== null && unitId !== "") payload.unitId = unitId;

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || payload[key] === null) {
      delete payload[key];
    }
  });

  return payload;
}

async function ensureUnitWithIds(course, unit) {
  if (!course || !unit) return unit;

  const currentId = unit.unitId ?? unit.id;
  if (currentId !== undefined && currentId !== null && currentId !== "") {
    return unit;
  }

  const courseTitle = norm(course.title);
  const unitTitle = normalizeUnitTitle(unit.title);

  if (!courseTitle || !unitTitle) return unit;

  const result = await api("/api/units", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ course: courseTitle, title: unitTitle })
  });

  const created = result?.unit || {};
  const resolvedUnitId = created.unitId ?? created.id ?? null;
  const resolvedCourseId = created.courseId ?? course.courseId ?? course.id ?? null;

  return {
    ...unit,
    id: resolvedUnitId,
    unitId: resolvedUnitId,
    courseId: resolvedCourseId,
    title: created.title || unitTitle,
    isVisible: created.isVisible !== false
  };
}

async function saveQuestion(qi) {
  if (saving) return;

  const unit = curUnit();
  if (!unit) {
    alert("保存先単元が見つかりません。");
    return;
  }

  const list = unit.questions || [];
  const question = (editingQuestionId != null
    ? list.find((item) => String(item?.id) === String(editingQuestionId))
    : null) || list[qi];

  if (!question) {
    alert("保存対象の問題が見つかりません。");
    return;
  }

  const fixedType = question.type;
  const fixedBlankCount = question.blankCount;
  const fixedAnswers = Array.isArray(question.answers) ? question.answers.slice() : [];

  try {
    await applyEditorToQuestion(question);
  } catch (error) {
    alert(error?.message || "入力内容に不備があります。");
    return;
  }

  if (editingQuestionId != null && question.type !== fixedType) {
    question.type = fixedType;
    if (isMultiBlankType(fixedType)) {
      question.blankCount = fixedBlankCount;
      question.answers = fixedAnswers;
    }
  }

  saving = true;

  try {
    const course = curCourse();
    const ensuredUnit = await ensureUnitWithIds(course, unit);

    if (course?.units?.[unitIndex]) {
      course.units[unitIndex] = ensuredUnit;
    }

    const resolvedCourseId = course?.courseId ?? course?.id ?? ensuredUnit?.courseId ?? question.courseId;
   const resolvedUnitId = ensuredUnit?.unitId ?? ensuredUnit?.id ?? unit.unitId ?? unit.id ?? question.unitId;
    
    if (!resolvedCourseId || !resolvedUnitId) {
      console.error("SAVE BLOCKED: unit id missing", { course, unit: ensuredUnit, question });
      alert("保存先単元IDがありません。単元を作成し直してください。");
      return;
    }

    question.courseId = resolvedCourseId;
    question.unitId = resolvedUnitId;

    const payload = buildQuestionPayload(question, {
      courseId: resolvedCourseId,
      unitId: resolvedUnitId
    });

    if (!payload.courseId || !payload.unitId) {
      throw new Error("新規問題の保存先(courseId/unitId)が不正です。");
    }

    const path = question.id ? `/api/questions/${question.id}` : "/api/questions";
    const method = question.id ? "PUT" : "POST";

    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    const text = await response.text();

    if (!response.ok) {
      console.error(text);
      throw new Error(`${response.status} ${response.statusText}`);
    }

    await loadData(true);
    editingQuestionId = null;
    renderAdmin();
  } catch (error) {
    alert(`保存エラー: ${error.message}`);
  } finally {
    saving = false;
  }
}

async function createQuestion(type) {
  const unit = curUnit();
  if (!unit) {
    alert("単元がありません。");
    return;
  }

 const question = normalizeQuestion({
  type,
  courseId: curCourse()?.courseId ?? curCourse()?.id,
  unitId: curUnit()?.unitId ?? curUnit()?.id
});

  try {
    await applyEditorToQuestion(question);
  } catch (error) {
    alert(error?.message || "入力内容に不備があります。");
    return;
  }

  unit.questions.push(question);
  await saveQuestion(unit.questions.length - 1);
}

async function deleteQuestion(qi) {
  if (deleting) return;

  const unit = curUnit();
  const question = unit?.questions?.[qi];

  if (!question) {
    alert("削除対象の問題が見つかりません。");
    return;
  }

  if (!confirm("削除しますか？")) return;

  deleting = true;

  try {
    if (question.id) {
      await api(`/api/questions/${question.id}`, { method: "DELETE" });
    } else {
      unit.questions.splice(qi, 1);
    }

    await loadData(true);
    renderAdmin();
  } catch (error) {
    alert(`削除エラー: ${error.message}`);
  } finally {
    deleting = false;
  }
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "questions.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

function updateAnswerInputsByBlankCount() {
  const input = document.getElementById("eq-blankCount");
  const box = document.getElementById("eq-answers");
  if (!input || !box) return;

  const count = Math.max(1, Math.min(20, Number(input.value) || 1));
  const previousValues = [...box.querySelectorAll(".edit-answer")].map((item) => item.value);

  let html = "";
  for (let i = 0; i < count; i += 1) {
    html += `
      <label>
        アンサー${i + 1}
        <input class="edit-answer" value="${esc(previousValues[i] || "")}">
      </label>
    `;
  }

  box.innerHTML = html;
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-act]");
  if (!target) return;

  const action = target.dataset.act;

  if (action === "home") {
    if (db.courses.length) renderUnits(courseIndex || 0);
    else renderHome();
  } else if (action === "open-admin") {
    await loadData(true);
    renderAdmin();
  } else if (action === "open-course") {
    renderUnits(Number(target.dataset.ci));
    }else if (action === "start-quiz") {
  courseIndex = Number(target.dataset.ci);
  unitIndex = Number(target.dataset.ui);
  questionIndex = 0;
  renderQuestion();
}
else if (action === "back-units") {
    renderUnits(courseIndex);
  } else if (action === "next-q") {
    questionIndex += 1;
    if (questionIndex >= (curUnit()?.questions || []).length) {
      renderUnits(courseIndex);
    } else {
      renderQuestion();
    }
  } else if (action === "ans-single") {
    const question = curQuestion();
    judge(norm(target.dataset.v) === norm(question.answer), question.answer);
  } else if (action === "ans-fill") {
    const question = curQuestion();
    judge(norm(document.getElementById("answerInput")?.value) === norm(question.answer), question.answer);
  } else if (action === "ans-multi") {
    const question = curQuestion();
    const got = [...document.querySelectorAll(".multi-answer:checked")]
      .map((item) => norm(item.value))
      .sort()
      .join("|");
    const expected = (question.answers || [])
      .map(norm)
      .sort()
      .join("|");
    judge(got === expected, (question.answers || []).join(", "));
} else if (action === "ans-fill-multi") {
  const question = curQuestion();
  const inputs = [...document.querySelectorAll(".blank-input")];
  const got = inputs.map((item) => norm(item.value));
  const expected = getAnswersForMultiBlank(question);

  let ok = got.length === expected.length;

  expected.forEach((_, index) => {
    const el = document.querySelector(`[data-blank-result="${index}"]`);
    if (el) {
      el.className = "blank-result";
      el.textContent = "";
    }
  });

  expected.forEach((_, index) => {
    const value = got[index] || "";
    const answerText = String(expected[index] || "");
    const patterns = answerText.split("|").map((v) => norm(v));

    const el = document.querySelector(`[data-blank-result="${index}"]`);
    if (!el) return;

  if (!value) {
  ok = false;
  el.className = "blank-result blank-ng";
  el.textContent = "❌ 正解: " + (patterns[0] || answerText);
} else if (patterns.includes(value)) {
  el.className = "blank-result blank-ok";
  el.textContent = "⭕ 正解";
} else {
  ok = false;
  el.className = "blank-result blank-ng";
  el.textContent = "❌ 正解: " + (patterns[0] || answerText);
}
  });

  judge(ok, expected.join(", "));
  } else if (action === "admin-back") {
    editingQuestionId = null;
    renderAdmin();
  } else if (action === "add-q") {
    renderQuestionTypeSelector();
  } else if (action === "pick-type") {
    renderCreateForType(target.dataset.type);
  } else if (action === "create-q") {
    await createQuestion(target.dataset.type);
  } else if (action === "edit-q") {
    renderEditQuestion(Number(target.dataset.qi));
  } else if (action === "save-q") {
    await saveQuestion(Number(target.dataset.qi));
  } else if (action === "del-q") {
    await deleteQuestion(Number(target.dataset.qi));
  } else if (action === "up-q") {
    const i = Number(target.dataset.qi);
    const questions = curUnit()?.questions || [];
    if (i > 0) {
      [questions[i - 1], questions[i]] = [questions[i], questions[i - 1]];
    }
    renderAdmin();
  } else if (action === "down-q") {
    const i = Number(target.dataset.qi);
    const questions = curUnit()?.questions || [];
    if (i < questions.length - 1) {
      [questions[i + 1], questions[i]] = [questions[i], questions[i + 1]];
    }
    renderAdmin();
  } else if (action === "add-course") {
    const name = prompt("科目名");
    if (name) {
      db.courses.push({
        title: norm(name),
        id: null,
        courseId: null,
        units: CANONICAL_UNITS.map((title) => ({
          id: null,
          unitId: null,
          title,
          isVisible: true,
          questions: []
        }))
      });
      courseIndex = db.courses.length - 1;
      unitIndex = 0;
    }
    renderAdmin();
  } else if (action === "ren-course") {
    const course = curCourse();
    if (!course) return;
    const name = prompt("科目名", course.title || "");
    if (name != null) {
      course.title = norm(name);
    }
    renderAdmin();
  } else if (action === "del-course") {
    if (confirm("科目を削除しますか？")) {
      db.courses.splice(courseIndex, 1);
      courseIndex = 0;
      unitIndex = 0;
    }
    renderAdmin();
  } else if (action === "add-unit") {
    const course = curCourse();
    if (!course) return;
    const name = prompt("単元名");
    if (name && course.title) {
      try {
        const result = await api("/api/units", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ course: norm(course.title), title: normalizeUnitTitle(name) })
        });

        const created = result?.unit || {};
        await loadData(true);

        const targetCourseIndex = db.courses.findIndex((item) => (
          String(item.courseId ?? item.id ?? "") === String(created.courseId ?? "")
        ));
        courseIndex = targetCourseIndex >= 0 ? targetCourseIndex : courseIndex;

        const units = db.courses[courseIndex]?.units || [];
        const targetUnitIndex = units.findIndex((item) => (
          String(item.unitId ?? item.id ?? "") === String(created.unitId ?? created.id ?? "")
        ));
        unitIndex = targetUnitIndex >= 0 ? targetUnitIndex : Math.max(0, units.length - 1);
      } catch (error) {
        alert(`単元追加エラー: ${error.message}`);
      }
    }
    renderAdmin();
  } else if (action === "ren-unit") {
    const unit = curUnit();
    if (!unit) return;
    const name = prompt("単元名", unit.title);
    if (name != null) {
      unit.title = normalizeUnitTitle(name);
    }
    renderAdmin();
  } else if (action === "toggle-unit") {
    const unit = curUnit();
    if (unit) {
      unit.isVisible = unit.isVisible === false ? true : false;
      if (unit.id || unit.unitId) {
        try {
          await api(`/api/units/${unit.unitId || unit.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ isVisible: unit.isVisible })
          });
        } catch (error) {
          console.warn(error);
        }
      }
    }
    renderAdmin();
  } else if (action === "del-unit") {
    const course = curCourse();
    if (course && confirm("単元削除しますか？")) {
      course.units.splice(unitIndex, 1);
      unitIndex = 0;
    }
    renderAdmin();
  } else if (action === "save-all") {
    alert("各問題の保存で反映されます。保存対象の問題を編集画面から保存してください。");
  } else if (action === "export-json") {
    downloadJson();
  } else if (action === "img-clear") {
    const preview = document.getElementById("img-preview");
    if (preview) preview.innerHTML = "";
    const fileInput = document.getElementById("eq-image-file");
    if (fileInput) fileInput.value = "";
  }
});

document.addEventListener("change", async (event) => {
  const id = event.target.id;

  if (id === "adminCourse") {
    courseIndex = Number(event.target.value);
    unitIndex = 0;
    renderAdmin();
  } else if (id === "adminUnit") {
    unitIndex = Number(event.target.value);
    renderAdmin();
  } else if (id === "importJson") {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      db = normalizeDatabase(JSON.parse(text));
      courseIndex = 0;
      unitIndex = 0;
      renderAdmin();
    } catch (error) {
      alert(`JSON読込エラー: ${error.message}`);
    }
  } else if (id === "eq-blankCount") {
    updateAnswerInputsByBlankCount();
  } else if (id === "eq-image-file") {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const preview = document.getElementById("img-preview");
      if (preview) {
        preview.innerHTML = `<img class="quiz-image" src="${esc(reader.result)}" alt="">`;
      }
    };
    reader.readAsDataURL(file);
  }
});

(async function init() {
  try {
    await loadData(false);
  } catch (error) {
    console.error(error);
    db = normalizeDatabase({ appTitle: "カイゴクイズ", courses: [] });
  }

  if (db.courses.length) {
    courseIndex = 0;
    unitIndex = 0;
    renderUnits(0);
  } else {
    renderHome();
  }
})();
