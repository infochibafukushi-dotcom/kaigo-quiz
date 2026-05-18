const API_BASE = window.KAIGO_QUIZ_API_BASE || "https://kaigo-quiz-save.info-chibafukushi.workers.dev";

let db = { appTitle: "カイゴクイズ", courses: [] };
let courseIndex = 0;
let unitIndex = 0;
let questionIndex = 0;
let saving = false;
let deleting = false;
let editingQuestionId = null;
let dxImportState = {
  files: [],
  parsedUnits: [],
  errors: [],
  repairLogs: [],
  previewReady: false,
  stats: null,
  loading: false,
  completed: false,
  mode: "replace",
  currentFileName: "",
  progressCurrent: 0,
  progressTotal: 0,
  resultMessage: ""
};

const app = document.getElementById("app");

const TYPES = ["choice", "ox", "multi", "fill", "fill_multi", "image_fill", "combo", "case"];

const TLABEL = {
  choice: "4択",
  ox: "○×",
  multi: "複数選択",
  fill: "記述",
  fill_multi: "空欄補充",
  image_fill: "画像穴埋め",
  combo: "組み合わせ",
  case: "事例"
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
const EXPECTED_UNIT_QUESTION_COUNTS = Object.freeze({
  "人間の尊厳と自立": 0,
  "介護の基本": 0,
  "コミュニケーション技術": 0,
  "社会の理解": 0,
  "認知症の理解": 0,
  "発達と老化の理解": 0,
  "障害の理解": 0,
  "こころとからだのしくみ1": 0,
  "こころとからだのしくみ2": 0,
  "介護過程1": 0,
  "介護過程2": 0
});

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


function upsertUnitQuestionsFromImport(rawData) {
  const unitTitle = normalizeUnitTitle(rawData?.unitTitle || "");
  if (!unitTitle) throw new Error("unitTitle が必要です");
  if (!Array.isArray(rawData?.questions)) throw new Error("questions は配列で指定してください");

  if (!Array.isArray(db.courses) || db.courses.length === 0) {
    db.courses = [{ id: null, courseId: null, title: CANONICAL_COURSE_TITLE, units: [] }];
  }

  const course = db.courses[0] || { id: null, courseId: null, title: CANONICAL_COURSE_TITLE, units: [] };
  if (!db.courses[0]) db.courses[0] = course;
  if (!Array.isArray(course.units)) course.units = [];

  const existingUnit = course.units.find((unit) => normalizeUnitTitle(unit?.title) === unitTitle);
  const unitId = existingUnit?.unitId ?? existingUnit?.id ?? null;
  const courseId = course.courseId ?? course.id ?? null;
  const importedQuestions = rawData.questions.map((question) => normalizeQuestion(question, courseId, unitId));

  if (existingUnit) {
    existingUnit.questions = importedQuestions;
    existingUnit.title = unitTitle;
    existingUnit.isVisible = existingUnit.isVisible !== false;
  } else {
    course.units.push({
      id: null,
      unitId: null,
      title: unitTitle,
      isVisible: true,
      questions: importedQuestions
    });
  }

  course.units = sortUnitsByCanonicalOrder(course.units);
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

      <hr>
      <h4>DXインポート</h4>
      <div class="actions">
        <label>
          反映モード
          <select id="dx-mode">
            <option value="replace" ${dxImportState.mode === "replace" ? "selected" : ""}>全置換反映</option>
            <option value="append" ${dxImportState.mode === "append" ? "selected" : ""}>追加反映（append）</option>
          </select>
        </label>
      </div>
      <div class="actions">
        <label class="secondary">
          docx複数/zip
          <input type="file" id="importDx" accept=".docx,.zip" multiple>
        </label>
        <button data-act="dx-run" ${dxImportState.loading ? "disabled" : ""}>DXインポート実行</button>
        <button data-act="dx-preview" ${dxImportState.loading ? "disabled" : ""}>プレビュー</button>
        <button class="danger" data-act="dx-apply" ${dxImportState.loading ? "disabled" : ""}>承認して反映</button>
      </div>
      <div id="dx-status" class="sub"></div>
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



async function saveAllImportedQuestions() {
  if (saving) return;

  console.log("IMPORT SAVE START");
  saving = true;

  const errors = [];
  const allQuestions = [];

  db.courses.forEach((course, ci) => {
    (course.units || []).forEach((unit, ui) => {
      (unit.questions || []).forEach((question, qi) => {
        allQuestions.push({ course, unit, question, ci, ui, qi });
      });
    });
  });

  const total = allQuestions.length;

  for (let i = 0; i < total; i += 1) {
    const item = allQuestions[i];
    const { course, question } = item;
    let { unit } = item;

    console.log(`SAVING QUESTION ${i + 1}/${total}`);

    try {
      const ensuredUnit = await ensureUnitWithIds(course, unit);
      if (course?.units?.[item.ui]) {
        course.units[item.ui] = ensuredUnit;
      }
      unit = ensuredUnit;

      const resolvedCourseId = course?.courseId ?? course?.id ?? unit?.courseId ?? question.courseId;
      const resolvedUnitId = unit?.unitId ?? unit?.id ?? question.unitId;

      if (!resolvedCourseId || !resolvedUnitId) {
        throw new Error('courseId/unitId missing');
      }

      question.courseId = resolvedCourseId;
      question.unitId = resolvedUnitId;

      const payload = buildQuestionPayload(question, {
        courseId: resolvedCourseId,
        unitId: resolvedUnitId
      });

      const path = question.id ? `/api/questions/${question.id}` : '/api/questions';
      const method = question.id ? 'PUT' : 'POST';

      const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('application/json') ? await response.json() : await response.text();

      if (!response.ok) {
        const message = typeof body === 'string'
          ? body
          : (body?.message || body?.error || `${response.status} ${response.statusText}`);
        throw new Error(message);
      }

      const savedId = body?.question?.id ?? body?.id ?? question.id ?? '(unknown)';
      if (!question.id && (body?.question?.id || body?.id)) {
        question.id = body?.question?.id ?? body?.id;
      }
      console.log(`SAVED QUESTION ID ${savedId}`);
    } catch (error) {
      console.error('IMPORT SAVE ERROR', {
        index: i + 1,
        total,
        error: error?.message || String(error),
        courseTitle: course?.title || '',
        unitTitle: unit?.title || '',
        question: question?.question || ''
      });
      errors.push({
        index: i + 1,
        message: error?.message || String(error),
        courseTitle: course?.title || '',
        unitTitle: unit?.title || ''
      });
    }
  }

  console.log('IMPORT SAVE COMPLETE');

  try {
    await loadData(true);
    renderAdmin();
  } catch (error) {
    console.error(error);
  }

  saving = false;

  if (errors.length) {
    alert(`JSON保存完了（一部失敗: ${errors.length}件）。コンソールを確認してください。`);
    return;
  }

  alert('JSON保存が完了しました。');
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
 el.textContent = "❌ 正解: " + answerText.replaceAll("|", " / ");
} else if (patterns.includes(value)) {
  el.className = "blank-result blank-ok";
    el.textContent = "⭕ 正解: " + answerText.replaceAll("|", " / ");
} else {
  ok = false;
  el.className = "blank-result blank-ng";
 el.textContent = "❌ 正解: " + answerText.replaceAll("|", " / ");
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
    await saveAllImportedQuestions();
  } else if (action === "export-json") {
    downloadJson();
  } else if (action === "dx-run") {
    if (dxImportState.loading) return;
    try {
      dxImportState.completed = false;
      dxImportState.resultMessage = "";
      await runDxImport();
      dxImportState.completed = true;
      dxImportState.resultMessage = "DXインポート解析が完了しました。";
      renderDxStatus();
    } catch (error) {
      dxImportState.completed = true;
      dxImportState.resultMessage = `DXインポートエラー: ${error.message}`;
      renderDxStatus();
      alert(`DXインポートエラー: ${error.message}`);
    }
  } else if (action === "dx-preview") {
    if (!dxImportState.previewReady) { alert("先にDXインポートを実行し、エラー0にしてください。"); return; }
    applyDxPreviewToDb();
    renderAdmin();
    renderDxStatus();
  } else if (action === "dx-apply") {
    if (dxImportState.loading) return;
    if (!dxImportState.previewReady) { alert("先にDXインポートを実行し、エラー0にしてください。"); return; }
    const isReplaceMode = dxImportState.mode === "replace";
    if (!confirm(isReplaceMode
      ? "既存問題を全置換して本番反映します。よろしいですか？"
      : "既存データを残したまま追加反映します。よろしいですか？")) return;
    if (isReplaceMode) {
      applyDxPreviewToDb();
      await api("/api/init-db?mode=replace");
      await saveAllImportedQuestions();
    } else {
      await appendDxPreviewToDb();
      await saveAllImportedQuestions();
    }
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
      const raw = JSON.parse(text);
      upsertUnitQuestionsFromImport(raw);
      db = normalizeDatabase(db);
      courseIndex = clampIndex(courseIndex, db.courses.length);
      unitIndex = clampIndex(unitIndex, db.courses[courseIndex]?.units?.length || 0);
      renderAdmin();
    } catch (error) {
      alert(`JSON読込エラー: ${error.message}`);
    }
  } else if (id === "importDx") {
    dxImportState.files = [...(event.target.files || [])];
    dxImportState.parsedUnits = [];
    dxImportState.errors = [];
    dxImportState.repairLogs = [];
    dxImportState.previewReady = false;
    dxImportState.stats = null;
    dxImportState.completed = false;
    dxImportState.resultMessage = "";
    dxImportState.currentFileName = "";
    dxImportState.progressCurrent = 0;
    dxImportState.progressTotal = 0;
    renderAdmin();
  } else if (id === "dx-mode") {
    dxImportState.mode = event.target.value === "append" ? "append" : "replace";
    renderDxStatus();
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


async function extractDocxText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return String(result.value || "");
}

function splitQuestionAndAnswerText(rawText) {
  const text = String(rawText || "");
  const markers = ["【答え】", "【解答】", "解答", "答え", "回答："];
  let splitIndex = -1;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    if (idx >= 0 && (splitIndex < 0 || idx < splitIndex)) splitIndex = idx;
  }
  if (splitIndex < 0) return { questionText: text, answerText: "" };
  return {
    questionText: text.slice(0, splitIndex).trim(),
    answerText: text.slice(splitIndex).trim()
  };
}

async function parseQuestionsViaWorker(unitTitle, sourceFile, rawText) {
  const { questionText, answerText } = splitQuestionAndAnswerText(rawText);
  const response = await fetch(`${API_BASE}/api/ai-parse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ unitTitle, sourceFile, rawText: questionText, answerText })
  });
  const body = await response.json();
  if (!response.ok || !body?.ok) {
    const message = body?.message || body?.error || `status ${response.status}`;
    const issues = Array.isArray(body?.issues) ? ` issues=${body.issues.join(", ")}` : "";
    throw new Error(`${sourceFile}: AI parse failed (${message})${issues}`);
  }
  return body;
}

function splitProblemAndAnswerSections(text) {
  const lines = String(text || "").split(/\r?\n/);
  const answerStart = lines.findIndex((line) => /^\s*【\s*答え(?:と問題形式)?\s*】\s*$/.test(line) || /^\s*答え(?:と問題形式)?\s*$/.test(line));
  if (answerStart < 0) return { problemText: text, answerText: "" };
  return {
    problemText: lines.slice(0, answerStart).join("\n"),
    answerText: lines.slice(answerStart + 1).join("\n")
  };
}

function parseQuestionMap(sectionText) {
  const lines = String(sectionText || "").split(/\r?\n/);
  const map = new Map();
  let currentNo = null;
  let buffer = [];
  const flush = () => {
    if (currentNo == null) return;
    map.set(currentNo, buffer.join("\n"));
  };
  for (const line of lines) {
    const m = line.match(/^\s*(?:Q|問)\s*([0-9０-９]+)\s*[\.．:：]?\s*(.*)$/i);
    if (m) {
      flush();
      currentNo = Number(String(m[1]).replace(/[０-９]/g, (d) => String("０１２３４５６７８９".indexOf(d))));
      buffer = [m[2] || ""];
    } else if (currentNo != null) {
      buffer.push(line);
    }
  }
  flush();
  return map;
}

function extractChoicesFromProblem(problemText) {
  return String(problemText || "")
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(/^\s*(?:[（(]?\s*)?([1-9１-９A-DＡ-Ｄ])[)）\.．]\s*(.+)\s*$/);
      return m ? `${m[1]} ${m[2]}` : null;
    })
    .filter(Boolean);
}

function extractParenTokens(text) {
  return [...String(text || "").matchAll(/（([^）]+)）/g)].map((m) => String(m[1] || ""));
}

function extractAnswersByType(problemText, answerText, guessedType) {
  const parenTokens = extractParenTokens(answerText);
  const cleaned = String(answerText || "").replace(/\r/g, "");
  const answerLines = cleaned.split("\n").map((v) => String(v || "").trim()).filter(Boolean);
  const normalizedTokens = parenTokens
    .flatMap((token) => String(token).split(/[|｜、,・\/]/))
    .map((v) => norm(v))
    .filter(Boolean);
  const oxTokens = [...cleaned.matchAll(/[〇○×]/g)].map((m) => m[0] === "〇" ? "○" : m[0]);

  if (guessedType === "ox") {
    const ox = oxTokens.length ? oxTokens : parenTokens.filter((t) => t.includes("〇") || t.includes("○") || t.includes("×"));
    return { answer: ox[0] || "", answers: ox };
  }
  if (guessedType === "multi" || guessedType === "combo" || guessedType === "fill_multi") {
    const line = cleaned.match(/(?:回答|解答|正解|答え)\s*[:：]\s*（?([^）\n]+)）?/);
    if (line && (line[1] || "").match(/[|｜、,・\/]/)) {
      return { answer: "", answers: String(line[1] || "").split(/[|｜、,・\/]/).map((v) => norm(v)).filter(Boolean) };
    }
    if (normalizedTokens.length > 0) return { answer: "", answers: normalizedTokens };
    if (answerLines.length > 0) return { answer: "", answers: answerLines.slice(0, 6) };
    return { answer: "", answers: [] };
  }
  if (guessedType === "fill") {
    const line = cleaned.match(/(?:回答|解答|正解|答え(?:例)?)\s*[:：]\s*(.+)$/m);
    if (line && line[1]) return { answer: norm(line[1].replace(/[（）]/g, "")), answers: [] };
    if (normalizedTokens.length) return { answer: normalizedTokens[0] || "", answers: [] };
    return { answer: norm(answerLines[0] || ""), answers: [] };
  }
  if (guessedType === "choice") {
    const line = cleaned.match(/(?:回答|解答|正解|答え)\s*[:：]\s*（?([^）\n]+)）?/);
    if (line) return { answer: norm(String(line[1] || "").split(/[|｜、,・\/]/)[0]), answers: [] };
    if (normalizedTokens.length) return { answer: normalizedTokens[0] || "", answers: [] };
    return { answer: norm(answerLines[0] || ""), answers: [] };
  }
  return { answer: normalizedTokens[0] || norm(answerLines[0] || ""), answers: normalizedTokens };
}

function detectTypeStrict(problemText, answerText, choices) {
  const p = String(problemText || "");
  const a = String(answerText || "");
  if (/事例/.test(p)) return "case";
  if (/組み合わせ|対応関係|組合せ/.test(p)) return "combo";
  if (/(?:^|\n)\s*(?:\d+[\.．]\s*)?[（(]?\s*[〇○×]\s*[)）]?/.test(a)) return "ox";
  if (/(?:回答|解答|正解|答え)\s*[:：]\s*（?[^）\n]*[|｜、,・\/][^）\n]*）?/.test(a)) return "multi";
  const choiceAnswer = /(?:回答|解答|正解|答え)\s*[:：]\s*（?\s*[0-9０-９A-DＡ-Ｄ①-④]\s*）?/.test(a);
  const choicePrompt = /番号を選び記入|適切な番号|選びなさい|選択肢/.test(p);
  if (choiceAnswer || (choices.length >= 2 && choicePrompt)) return "choice";
  const blankHits = (p.match(/[（(]\s*(?:　|_|\s)*\s*[)）]/g) || []).length;
  if (blankHits >= 2) return "fill_multi";
  if (blankHits === 1 || /穴埋め|空欄/.test(p)) return "fill";
  if (choices.length >= 2) return "choice";
  return "fill";
}

function buildQuestionFromPair(no, problemText, answerText) {
  const choices = extractChoicesFromProblem(problemText);
  const type = detectTypeStrict(problemText, answerText, choices);
  const extracted = extractAnswersByType(problemText, answerText, type);
  const question = normalizeQuestion({
    id: `dx-${no}`,
    type,
    question: String(problemText || ""),
    choices,
    answer: extracted.answer || "",
    answers: Array.isArray(extracted.answers) ? extracted.answers : []
  });
  if (type === "fill_multi" || type === "image_fill") {
    question.blankCount = Math.max(1, question.answers.length || 1);
  }
  return question;
}

function buildQuestionsFromDocxText(unitTitle, text) {
  const { problemText, answerText } = splitProblemAndAnswerSections(text);
  const problems = parseQuestionMap(problemText);
  const answers = parseQuestionMap(answerText);
  const items = [];
  const ordered = [...problems.entries()].sort((a, b) => a[0] - b[0]);
  for (const [no, pText] of ordered) {
    if (shouldSkipQuestionBySpec(unitTitle, `問${no}`)) continue;
    items.push(buildQuestionFromPair(no, pText, answers.get(no) || ""));
  }
  return items;
}

async function extractDocxFilesFromUpload(files) {
  const out = [];
  for (const f of files) {
    if (f.name.toLowerCase().endsWith('.docx')) out.push(f);
    if (f.name.toLowerCase().endsWith('.zip')) {
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      for (const name of Object.keys(zip.files)) {
        if (name.toLowerCase().endsWith('.docx')) {
          const blob = await zip.files[name].async('blob');
          out.push(new File([blob], name.split('/').pop() || name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
        }
      }
    }
  }
  return out;
}

function toCanonicalType(type, q) {
  if (TYPES.includes(type)) return type;
  if (type === "single") return "choice";
  if (type === "boolean") return "ox";
  if (Array.isArray(q?.answers) && q.answers.length > 1) return "multi";
  return "fill";
}

function applyQuestionStructureFix(question, idx) {
  const fixed = { ...question };
  fixed.id = fixed.id ?? `dx-${idx + 1}`;
  fixed.type = toCanonicalType(fixed.type, fixed);
  fixed.blankCount = Math.max(1, Number(fixed.blankCount) || (Array.isArray(fixed.answers) ? fixed.answers.length : 1));

  if (!Array.isArray(fixed.choices)) fixed.choices = [];
  if (!Array.isArray(fixed.answers)) {
    if (fixed.answers == null) fixed.answers = [];
    else fixed.answers = [String(fixed.answers)];
  }

  if (fixed.type === "multi" && fixed.answers.length === 0 && typeof fixed.answer === "string" && fixed.answer !== "") {
    fixed.answers = [fixed.answer];
  }

  if ((fixed.type === "fill_multi" || fixed.type === "image_fill") && fixed.answers.length === 0 && typeof fixed.answer === "string" && fixed.answer !== "") {
    fixed.answers = [fixed.answer];
  }

  return fixed;
}

function runRepairLoop(parsedUnits) {
  const logs = [];
  let units = JSON.parse(JSON.stringify(parsedUnits));
  for (let i = 1; i <= 10; i += 1) {
    const errors = [];
    units.forEach((u, ui) => {
      if (!u.unitTitle) errors.push(`unit[${ui}] title missing`);
      if (!Array.isArray(u.questions)) errors.push(`questions array missing ${u.unitTitle || ui}`);
      (u.questions || []).forEach((q, qi) => {
        if (!q || typeof q !== "object") errors.push(`q object missing ${u.unitTitle}#${qi + 1}`);
        if (!q.question) errors.push(`q missing text ${u.unitTitle}#${qi + 1}`);
      });
    });

    if (!errors.length) {
      logs.push(`check#${i}: 0 error`);
      return { units, errors: [], logs };
    }

    logs.push(`check#${i}: ${errors.length} error`);
    units = units.map((u) => ({
      ...u,
      unitTitle: normalizeUnitTitle(u.unitTitle || "") || u.unitTitle,
      questions: Array.isArray(u.questions)
        ? u.questions.map((q, qi) => applyQuestionStructureFix(q || {}, qi))
        : []
    }));
  }

  const finalErrors = ["最大10回の修復で0エラーに到達できませんでした"];
  return { units, errors: finalErrors, logs };
}

function shouldSkipQuestionBySpec(unitTitle, block) {
  if (normalizeUnitTitle(unitTitle) !== "障害の理解") return false;
  const m = String(block || "").match(/^(?:Q|問)\s*(\d+)/i);
  if (!m) return false;
  const n = Number(m[1]);
  return n === 1 || n === 8;
}

function buildDxStats(units, skipFlags) {
  const stats = {
    unitCount: units.length,
    questionCount: 0,
    typeCounts: {},
    answerMissing: 0,
    choicesMissing: 0,
    blankCountMismatch: 0,
    questionAnswerLeak: 0,
    workerIssues: 0,
    unitCountMismatch: 0,
    expectedUnitCounts: {},
    actualUnitCounts: {},
    skippedShogai: skipFlags || { q1: false, q8: false }
  };

  units.forEach((u) => {
    stats.actualUnitCounts[u.unitTitle] = (u.questions || []).length;
    (u.questions || []).forEach((q) => {
      stats.questionCount += 1;
      stats.typeCounts[q.type] = (stats.typeCounts[q.type] || 0) + 1;

      const requiresAnswers = q.type === "multi" || q.type === "fill_multi" || q.type === "combo";
      if (requiresAnswers) {
        if (!Array.isArray(q.answers) || q.answers.length === 0) stats.answerMissing += 1;
      } else if (!String(q.answer || "")) {
        stats.answerMissing += 1;
      }

      if ((q.type === "choice" || q.type === "multi") && (!Array.isArray(q.choices) || q.choices.length < 2)) {
        stats.choicesMissing += 1;
      }

      if ((q.type === "fill_multi" || q.type === "image_fill")) {
        const len = Array.isArray(q.answers) ? q.answers.length : 0;
        if (Number(q.blankCount) !== len) stats.blankCountMismatch += 1;
      }

      const tokens = [String(q.answer || ""), ...((q.answers || []).map((v) => String(v)))].filter(Boolean);
      if (tokens.some((t) => String(q.question || "").includes(t))) stats.questionAnswerLeak += 1;
    });
  });
  Object.keys(EXPECTED_UNIT_QUESTION_COUNTS).forEach((title) => {
    const expected = Number(EXPECTED_UNIT_QUESTION_COUNTS[title]);
    const actual = Number(stats.actualUnitCounts[title] || 0);
    stats.expectedUnitCounts[title] = expected;
    if (expected > 0 && actual !== expected) stats.unitCountMismatch += 1;
  });

  return stats;
}

function buildExpectedUnitCountsFromCurrentDb() {
  const expected = { ...EXPECTED_UNIT_QUESTION_COUNTS };
  const currentUnits = db?.courses?.[0]?.units || [];
  currentUnits.forEach((unit) => {
    const title = normalizeUnitTitle(unit?.title || "");
    if (!title) return;
    if (Number(expected[title] || 0) <= 0) {
      expected[title] = Array.isArray(unit?.questions) ? unit.questions.length : 0;
    }
  });
  return expected;
}

function evaluateDxQualityGate(stats, mode = "replace") {
  const failures = [];
  if (!stats || typeof stats !== "object") {
    return { ok: false, failures: ["stats missing"] };
  }

  const normalizedMode = mode === "append" ? "append" : "replace";

  if (normalizedMode === "append") {
    if (Number(stats.answerMissing) !== 0) failures.push(`answer欠落NG(${stats.answerMissing})`);
    if (Number(stats.choicesMissing) !== 0) failures.push(`choices欠落NG(${stats.choicesMissing})`);
    if (Number(stats.blankCountMismatch) !== 0) failures.push(`blankCount不整合NG(${stats.blankCountMismatch})`);
    if (Number(stats.questionAnswerLeak) !== 0) failures.push(`question答え混入NG(${stats.questionAnswerLeak})`);
    if (Number(stats.workerIssues) !== 0) failures.push(`worker issues NG(${stats.workerIssues})`);
    return { ok: failures.length === 0, failures };
  }

  if (Number(stats.unitCountMismatch) !== 0) failures.push(`unitCount不一致NG(${stats.unitCountMismatch})`);
  if (Number(stats.questionAnswerLeak) !== 0) failures.push(`question答え混入NG(${stats.questionAnswerLeak})`);
  if (Number(stats.totalUnits) !== 11) failures.push(`11単元完走NG(${stats.totalUnits || 0}/11)`);

  const requiredTypes = ["ox", "choice", "multi", "fill", "fill_multi", "combo", "case"];
  requiredTypes.forEach((type) => {
    const count = Number(stats.typeCounts?.[type] || 0);
    if (count <= 0) failures.push(`type=${type} 0件`);
  });

  if (!stats.skippedShogai?.q1 || !stats.skippedShogai?.q8) failures.push("障害の理解固定チェックNG");

  return { ok: failures.length === 0, failures };
}

async function runDxImport() {
  if (!dxImportState.files.length) throw new Error('docx/zipファイルを選択してください');
  dxImportState.loading = true;
  renderAdmin();
  try {
    const docxFiles = await extractDocxFilesFromUpload(dxImportState.files);
    const parsedUnits = [];
    const timings = [];
    let workerIssues = 0;
    const skipLogs = [];
    const skipFlags = { q1: false, q8: false };
    dxImportState.progressTotal = docxFiles.length;
    for (let index = 0; index < docxFiles.length; index += 1) {
      const file = docxFiles[index];
      dxImportState.currentFileName = file.name;
      dxImportState.progressCurrent = index + 1;
      renderDxStatus();
      const startedAt = Date.now();
      const unitTitleRaw = file.name.replace(/\.docx$/i, '');
      const unitTitle = normalizeUnitTitle(unitTitleRaw);
      const text = await extractDocxText(file);
      const parsed = await parseQuestionsViaWorker(unitTitle, file.name, text);
      workerIssues += Array.isArray(parsed.issues) ? parsed.issues.length : 0;
      const questions = (Array.isArray(parsed.questions) ? parsed.questions : []).map((q, idx) => applyQuestionStructureFix(q, idx));
      timings.push({ unitTitle, ms: Date.now() - startedAt });
      const skipped = [1, 8].filter((n) => normalizeUnitTitle(unitTitle) === "障害の理解" && !questions.some((q) => String(q.id) === `dx-${n}`));
      skipped.forEach((n) => {
        skipLogs.push(`${file.name}: 問${n} を仕様スキップ`);
        if (n === 1) skipFlags.q1 = true;
        if (n === 8) skipFlags.q8 = true;
      });
      parsedUnits.push({ unitTitle, source: file.name, questions });
    }
    const repaired = runRepairLoop(parsedUnits);
    dxImportState.parsedUnits = repaired.units;
    dxImportState.errors = repaired.errors;
    dxImportState.repairLogs = [...skipLogs, ...repaired.logs];
    dxImportState.stats = buildDxStats(repaired.units, skipFlags);
    const expectedCounts = buildExpectedUnitCountsFromCurrentDb();
    dxImportState.stats.expectedUnitCounts = expectedCounts;
    dxImportState.stats.unitCountMismatch = Object.keys(expectedCounts).reduce((acc, title) => {
      const expected = Number(expectedCounts[title] || 0);
      const actual = Number(dxImportState.stats.actualUnitCounts[title] || 0);
      return acc + ((expected > 0 && actual !== expected) ? 1 : 0);
    }, 0);
    dxImportState.stats.workerIssues = workerIssues;
    dxImportState.stats.totalUnits = timings.length;
    dxImportState.stats.totalSeconds = timings.reduce((a, t) => a + t.ms, 0) / 1000;
    dxImportState.stats.avgSecondsPerUnit = timings.length ? (dxImportState.stats.totalSeconds / timings.length) : 0;
    const gate = evaluateDxQualityGate(dxImportState.stats, dxImportState.mode);
    if (!gate.ok) {
      dxImportState.errors = [...dxImportState.errors, ...gate.failures];
    }
    dxImportState.previewReady = dxImportState.errors.length === 0;
  } finally {
    dxImportState.loading = false;
    dxImportState.currentFileName = "";
    renderAdmin();
  }
}

function renderDxStatus() {
  const box = document.getElementById('dx-status');
  if (!box) return;
  const unitCount = dxImportState.parsedUnits.length;
  const qCount = dxImportState.parsedUnits.reduce((a, u) => a + (u.questions||[]).length, 0);
  const st = dxImportState.stats;
  const typeText = st ? Object.entries(st.typeCounts).map(([k, v]) => `${k}:${v}`).join(", ") : "";
  const gate = st ? evaluateDxQualityGate(st, dxImportState.mode) : { ok: false, failures: ["stats missing"] };
  const metrics = st
    ? `<br>type別件数: ${esc(typeText)}<br>answer欠落件数: ${st.answerMissing}<br>choices欠落件数: ${st.choicesMissing}<br>blankCount不整合件数: ${st.blankCountMismatch}<br>questionへの答え混入検知件数: ${st.questionAnswerLeak}<br>worker issues件数: ${st.workerIssues}<br>unitCount不一致件数: ${st.unitCountMismatch}<br>11単元完走: ${st.totalUnits === 11 ? "OK" : "NG"} (${st.totalUnits || 0}/11)<br>1単元平均秒数: ${(Number(st.avgSecondsPerUnit) || 0).toFixed(2)}秒<br>品質ゲート: ${gate.ok ? "OK" : "NG"}${gate.ok ? "" : `<br>ゲート失敗: ${esc(gate.failures.join(' / '))}`}<br>障害の理解 問1/問8 スキップ確認: ${st.skippedShogai.q1 ? "OK" : "NG"}/${st.skippedShogai.q8 ? "OK" : "NG"}`
    : "";
  const loadingText = dxImportState.loading
    ? `AI解析中...<br>${esc(dxImportState.currentFileName)} を解析中...<br>${dxImportState.progressCurrent} / ${dxImportState.progressTotal} ファイル<br>`
    : "";
  const resultText = dxImportState.completed && dxImportState.resultMessage
    ? `${esc(dxImportState.resultMessage)}<br>`
    : "";
  box.innerHTML = `${loadingText}${resultText}取込単元: ${unitCount} / 問題数: ${qCount}${metrics}<br>${dxImportState.repairLogs.map(esc).join('<br>')}${dxImportState.errors.length ? `<br>ERROR: ${esc(dxImportState.errors.join('; '))}` : ''}`;
}

function applyDxPreviewToDb() {
  const course = db.courses[0] || { id:null, courseId:null, title: CANONICAL_COURSE_TITLE, units: [] };
  course.units = CANONICAL_UNITS.map((title) => {
    const found = dxImportState.parsedUnits.find((u) => normalizeUnitTitle(u.unitTitle) === title);
    return { id:null, unitId:null, title, isVisible:true, questions:(found?.questions || []).map((q)=>normalizeQuestion(q, course.courseId??course.id, null)) };
  });
  db.courses = [course];
  courseIndex=0; unitIndex=0;
}

function questionSignature(question) {
  const answers = Array.isArray(question.answers) ? question.answers.map((v) => norm(v)).sort().join("|") : "";
  return [
    norm(question.type),
    norm(question.question),
    norm(question.answer),
    answers
  ].join("::");
}

async function appendDxPreviewToDb() {
  await loadData(true);
  const course = db.courses[0] || { id: null, courseId: null, title: CANONICAL_COURSE_TITLE, units: [] };
  if (!db.courses[0]) db.courses[0] = course;
  for (const parsedUnit of dxImportState.parsedUnits) {
    const unitTitle = normalizeUnitTitle(parsedUnit.unitTitle);
    let unit = (course.units || []).find((u) => normalizeUnitTitle(u.title) === unitTitle);
    if (!unit) {
      unit = { id: null, unitId: null, title: unitTitle, isVisible: true, questions: [] };
      course.units.push(unit);
    }
    const existingSet = new Set((unit.questions || []).map((q) => questionSignature(q)));
    const toAppend = [];
    for (const question of (parsedUnit.questions || [])) {
      const normalizedQuestion = normalizeQuestion(question, course.courseId ?? course.id, unit.unitId ?? unit.id);
      const signature = questionSignature(normalizedQuestion);
      if (existingSet.has(signature)) continue;
      existingSet.add(signature);
      toAppend.push(normalizedQuestion);
    }
    unit.questions = [...(unit.questions || []), ...toAppend];
  }
  course.units = sortUnitsByCanonicalOrder(course.units || []);
}

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
