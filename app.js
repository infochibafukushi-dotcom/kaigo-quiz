const API_BASE = window.KAIGO_QUIZ_API_BASE || "https://kaigo-quiz-save.info-chibafukushi.workers.dev";

let db = { appTitle: "カイゴクイズ", courses: [] };
let courseIndex = 0;
let unitIndex = 0;
let questionIndex = 0;
let view = "home";
let saving = false;
let deleting = false;

const app = document.getElementById("app");

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function norm(v) { return String(v ?? "").trim(); }
function ensureDbShape(data) {
  const safe = data && typeof data === "object" ? data : {};
  if (!Array.isArray(safe.courses)) safe.courses = [];
  safe.courses = safe.courses.map((c) => ({
    ...c,
    title: c?.title || "",
    units: Array.isArray(c?.units) ? c.units.map((u) => ({
      ...u,
      title: u?.title || "",
      isVisible: u?.isVisible !== false,
      questions: Array.isArray(u?.questions) ? u.questions.map(normalizeQuestion) : []
    })) : []
  }));
  return { appTitle: safe.appTitle || "カイゴクイズ", courses: safe.courses };
}
function normalizeQuestion(q) {
  const qq = q && typeof q === "object" ? { ...q } : {};
  qq.type = qq.type || "fill";
  qq.question = qq.question || "";
  qq.explanation = qq.explanation || "";
  qq.choices = Array.isArray(qq.choices) ? qq.choices : [];
  qq.answer = qq.answer ?? "";
  qq.answers = Array.isArray(qq.answers) ? qq.answers : [];
  qq.blankCount = Number(qq.blankCount) > 0 ? Number(qq.blankCount) : (qq.answers.length || 1);
  return qq;
}
function isMultiBlankType(t) { return t === "fill_multi" || t === "image_fill"; }
function getAnswers(q) {
  if (isMultiBlankType(q.type)) {
    const count = Math.max(1, Number(q.blankCount) || 1);
    const src = Array.isArray(q.answers) ? q.answers.slice() : [];
    while (src.length < count) src.push("");
    return src.slice(0, count);
  }
  return [norm(q.answer)];
}

async function api(path, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

async function loadData(admin = false) {
  const data = await api(`/api/questions${admin ? "?admin=1" : ""}`);
  db = ensureDbShape(data);
}

function renderHome() {
  view = "home";
  let html = `<div class="topbar"><button class="secondary" data-act="open-admin">⚙ 管理</button></div><div class="card"><h1>${escapeHtml(db.appTitle)}</h1><p>科目を選択してください</p></div>`;
  db.courses.forEach((c, ci) => {
    html += `<div class="card unit-card" data-act="open-course" data-ci="${ci}"><div>${escapeHtml(c.title)}</div><div class="sub">›</div></div>`;
  });
  app.innerHTML = html;
}
function renderUnits(ci) {
  view = "units";
  courseIndex = ci;
  const c = db.courses[ci];
  let html = `<div class="topbar"><button class="secondary" data-act="home">戻る</button><button class="secondary" data-act="open-admin">⚙ 管理</button></div><div class="card"><h2>${escapeHtml(c.title)}</h2></div>`;
  c.units.forEach((u, ui) => {
    if (u.isVisible === false) return;
    html += `<div class="card unit-card" data-act="start-quiz" data-ci="${ci}" data-ui="${ui}"><div>${escapeHtml(u.title)}</div><div class="sub">${u.questions.length}問</div></div>`;
  });
  app.innerHTML = html;
}
function renderQuestion() {
  view = "quiz";
  const unit = db.courses[courseIndex].units[unitIndex];
  const q = unit.questions[questionIndex];
  const qImg = norm(q.imageData || q.imageUrl || q.image);
  let html = `<div class="topbar"><button class="secondary" data-act="back-units">単元へ</button></div><div class="card"><h3>${escapeHtml(unit.title)} ${questionIndex + 1}/${unit.questions.length}</h3>`;
  if (qImg) html += `<img class="quiz-image" src="${escapeHtml(qImg)}" alt="問題画像">`;
  html += `<p>${escapeHtml(q.question)}</p>`;
  if (q.type === "ox") {
    html += `<button data-act="ans-single" data-v="○">○</button><button data-act="ans-single" data-v="×">×</button>`;
  } else if (q.type === "choice") {
    q.choices.forEach((c) => { html += `<button data-act="ans-single" data-v="${escapeHtml(c)}">${escapeHtml(c)}</button>`; });
  } else if (q.type === "multi") {
    q.choices.forEach((c) => { html += `<label><input type="checkbox" class="multi-answer" value="${escapeHtml(c)}">${escapeHtml(c)}</label>`; });
    html += `<button data-act="ans-multi">回答</button>`;
  } else if (q.type === "fill") {
    html += `<input id="answerInput" /><button data-act="ans-fill">回答</button>`;
  } else if (isMultiBlankType(q.type)) {
    const answers = getAnswers(q);
    answers.forEach((_, i) => { html += `<input class="blank-input" data-i="${i}" placeholder="${i + 1}">`; });
    html += `<button data-act="ans-fill-multi">回答</button>`;
  }
  html += `<div id="result"></div></div>`;
  app.innerHTML = html;
}
function judgeAndShow(ok, expectedText) {
  const el = document.getElementById("result");
  el.innerHTML = `<p class="${ok ? "result-ok" : "result-ng"}">${ok ? "✅正解" : "❌不正解"}</p><p>正解: ${escapeHtml(expectedText)}</p><button data-act="next-q">次へ</button>`;
}
function renderComplete() {
  app.innerHTML = `<div class="card"><h2>単元終了</h2><button data-act="back-units">単元へ戻る</button></div>`;
}

function renderAdmin() {
  view = "admin";
  const c = db.courses[courseIndex] || db.courses[0];
  courseIndex = Math.max(0, db.courses.indexOf(c));
  const u = c?.units?.[unitIndex] || c?.units?.[0];
  unitIndex = Math.max(0, c?.units?.indexOf(u));
  let html = `<div class="topbar"><button class="secondary" data-act="home">TOP</button><button data-act="save-all" ${saving ? "disabled" : ""}>保存</button></div>`;
  html += `<div class="card"><h3>管理画面</h3><label>科目<select id="adminCourse">`;
  db.courses.forEach((x, i) => { html += `<option value="${i}" ${i === courseIndex ? "selected" : ""}>${escapeHtml(x.title)}</option>`; });
  html += `</select></label><label>単元<select id="adminUnit">`;
  (db.courses[courseIndex]?.units || []).forEach((x, i) => { html += `<option value="${i}" ${i === unitIndex ? "selected" : ""}>${escapeHtml(x.title)}</option>`; });
  html += `</select></label><button data-act="add-q">問題追加</button><button data-act="export-json">JSON出力</button><input type="file" id="importJson" accept="application/json"></div>`;
  html += `<div class="card"><h4>問題一覧</h4>`;
  const unit = db.courses[courseIndex]?.units?.[unitIndex];
  (unit?.questions || []).forEach((q, i) => {
    html += `<div class="card"><div>${i + 1}. ${escapeHtml(q.type)} - ${escapeHtml(q.question.slice(0, 40))}</div><button data-act="edit-q" data-qi="${i}">編集</button><button data-act="del-q" data-qi="${i}" ${deleting ? "disabled" : ""}>削除</button></div>`;
  });
  html += `</div>`;
  app.innerHTML = html;
}

function renderEditQuestion(qi) {
  const q = db.courses[courseIndex].units[unitIndex].questions[qi];
  const answers = getAnswers(q);
  let answerInputs = "";
  if (isMultiBlankType(q.type)) {
    for (let i = 0; i < Number(q.blankCount); i++) answerInputs += `<input class="edit-answer" data-i="${i}" value="${escapeHtml(answers[i] || "")}">`;
  }
  app.innerHTML = `<div class="topbar"><button data-act="admin-back">戻る</button></div><div class="card">
  <input id="eq-question" value="${escapeHtml(q.question)}">
  <select id="eq-type"><option>fill</option><option>fill_multi</option><option>image_fill</option><option>ox</option><option>choice</option><option>multi</option></select>
  <input id="eq-blankCount" type="number" min="1" value="${Number(q.blankCount) || 1}">
  <textarea id="eq-choices">${escapeHtml((q.choices || []).join("\n"))}</textarea>
  <input id="eq-answer" value="${escapeHtml(q.answer || "")}">
  <div id="eq-answers">${answerInputs}</div>
  <button data-act="upload-image" data-qi="${qi}">画像アップロード</button>
  <button data-act="save-q" data-qi="${qi}" ${saving ? "disabled" : ""}>保存</button></div>`;
  document.getElementById("eq-type").value = q.type;
}

async function saveQuestion(qi) {
  if (saving) return;
  const q = db.courses[courseIndex].units[unitIndex].questions[qi];
  q.question = norm(document.getElementById("eq-question").value);
  q.type = document.getElementById("eq-type").value;
  q.blankCount = Math.max(1, Number(document.getElementById("eq-blankCount").value) || 1);
  q.choices = document.getElementById("eq-choices").value.split("\n").map(norm).filter(Boolean);
  q.answer = norm(document.getElementById("eq-answer").value);
  if (isMultiBlankType(q.type)) {
    q.answers = [...document.querySelectorAll(".edit-answer")].map((x) => norm(x.value));
    if (q.answers.length !== q.blankCount) {
      alert("blankCount と answers 数が一致しないため保存できません。");
      return;
    }
  }
  saving = true;
  try {
    const body = JSON.stringify({ courseIndex, unitIndex, questionIndex: qi, question: q });
    if (q.id) await api(`/api/questions/${q.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body });
    else await api(`/api/questions`, { method: "POST", headers: { "content-type": "application/json" }, body });
    await loadData(true);
    renderAdmin();
  } catch (e) {
    alert(`保存エラー: ${e.message}`);
  } finally { saving = false; }
}

async function deleteQuestion(qi) {
  if (deleting) return;
  const unit = db.courses[courseIndex].units[unitIndex];
  const q = unit.questions[qi];
  deleting = true;
  try {
    if (q.id) await api(`/api/questions/${q.id}`, { method: "DELETE" });
    else unit.questions.splice(qi, 1);
    await loadData(true);
    renderAdmin();
  } catch (e) {
    alert(`削除エラー: ${e.message}`);
  } finally { deleting = false; }
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const a = t.dataset.act;
  if (a === "home") renderHome();
  else if (a === "open-admin") { await loadData(true); renderAdmin(); }
  else if (a === "open-course") renderUnits(Number(t.dataset.ci));
  else if (a === "start-quiz") { courseIndex = Number(t.dataset.ci); unitIndex = Number(t.dataset.ui); questionIndex = 0; renderQuestion(); }
  else if (a === "back-units") renderUnits(courseIndex);
  else if (a === "next-q") { questionIndex += 1; const unit = db.courses[courseIndex].units[unitIndex]; if (questionIndex >= unit.questions.length) renderComplete(); else renderQuestion(); }
  else if (a === "ans-single") { const q = db.courses[courseIndex].units[unitIndex].questions[questionIndex]; judgeAndShow(norm(t.dataset.v) === norm(q.answer), q.answer); }
  else if (a === "ans-fill") { const q = db.courses[courseIndex].units[unitIndex].questions[questionIndex]; const v = norm(document.getElementById("answerInput").value); judgeAndShow(v === norm(q.answer), q.answer); }
  else if (a === "ans-multi") { const q = db.courses[courseIndex].units[unitIndex].questions[questionIndex]; const got = [...document.querySelectorAll(".multi-answer:checked")].map((x) => norm(x.value)).sort().join("|"); const exp = (q.answers || []).map(norm).sort().join("|"); judgeAndShow(got === exp, (q.answers || []).join(",")); }
  else if (a === "ans-fill-multi") { const q = db.courses[courseIndex].units[unitIndex].questions[questionIndex]; const got = [...document.querySelectorAll(".blank-input")].map((x) => norm(x.value)); const exp = getAnswers(q); const ok = got.length === exp.length && got.every((x, i) => x === norm(exp[i])); judgeAndShow(ok, exp.join(", ")); }
  else if (a === "add-q") { db.courses[courseIndex].units[unitIndex].questions.push(normalizeQuestion({ type: "fill", question: "", answer: "" })); renderAdmin(); }
  else if (a === "edit-q") renderEditQuestion(Number(t.dataset.qi));
  else if (a === "admin-back") renderAdmin();
  else if (a === "save-q") await saveQuestion(Number(t.dataset.qi));
  else if (a === "del-q") await deleteQuestion(Number(t.dataset.qi));
  else if (a === "save-all") { alert("各問題の保存で反映されます。保存対象の問題を編集画面から保存してください。"); }
});

document.addEventListener("change", async (e) => {
  const id = e.target.id;
  if (id === "adminCourse") { courseIndex = Number(e.target.value); unitIndex = 0; renderAdmin(); }
  else if (id === "adminUnit") { unitIndex = Number(e.target.value); renderAdmin(); }
  else if (id === "eq-blankCount") {
    const cnt = Math.max(1, Number(e.target.value) || 1);
    const box = document.getElementById("eq-answers");
    const prev = [...box.querySelectorAll(".edit-answer")].map((x) => x.value);
    let html = "";
    for (let i = 0; i < cnt; i++) html += `<input class="edit-answer" data-i="${i}" value="${escapeHtml(prev[i] || "")}">`;
    box.innerHTML = html;
  } else if (id === "importJson") {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    db = ensureDbShape(JSON.parse(text));
    renderAdmin();
  }
});

window.renderAdmin = renderAdmin;
window.renderQuestion = renderQuestion;
window.saveQuestion = saveQuestion;
window.deleteQuestion = deleteQuestion;

(async function init() {
  try { await loadData(false); } catch (e) { console.error(e); }
  renderHome();
})();
