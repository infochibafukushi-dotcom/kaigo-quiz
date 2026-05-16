/* app.js 復旧版
 * 目的：
 * - 壊れた app.js を JavaScript として正常動作する状態へ復旧
 * - 新機能追加ではなく、問題追加・編集・削除・保存・空欄数連動の安定化を優先
 * - 既存HTML側から onclick で呼ばれる想定のため、主要関数は window に公開
 */

(() => {
  "use strict";

  let db = null;
  let view = "home";
  let courseIndex = 0;
  let unitIndex = 0;
  let questionIndex = 0;
  let lastResultShown = false;
  let editingImageData = "";
  let editAnswersCache = [];
  let isSavingQuestion = false;
  let isSyncingAll = false;

  const app = document.getElementById("app");
  const API_BASE =
    window.KAIGO_QUIZ_API_BASE ||
    "https://kaigo-quiz-save.info-chibafukushi.workers.dev";

  if (!app) {
    console.error("app.js: #app が見つかりません。");
    return;
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));
  }

  function normalize(value) {
    return String(value ?? "").trim();
  }

  function normalizeForCompare(value) {
    return normalize(value).normalize("NFKC").toLowerCase();
  }

  function toCircledNumber(n) {
    const base = 0x2460;
    if (n >= 1 && n <= 20) return String.fromCharCode(base + n - 1);
    return String(n);
  }

  function labelType(type) {
    return {
      fill: "記述",
      fill_multi: "空欄補充",
      image_fill: "画像＋空欄補充",
      ox: "○×",
      choice: "選択",
      Choice: "選択",
      multi: "複数選択",
    }[type] || String(type || "未設定");
  }

  function normalizeQuestionType(type) {
    if (type === "Choice") return "choice";
    return type || "fill";
  }

  function ensureDbShape(data) {
    const safe = data && typeof data === "object" ? data : {};
    if (!Array.isArray(safe.courses)) safe.courses = [];
    safe.appTitle = normalize(safe.appTitle || "カイゴクイズ");

    safe.courses = safe.courses.map((course) => {
      const c = course && typeof course === "object" ? course : {};
      c.title = normalize(c.title || c.name || "未設定の科目");
      if (!Array.isArray(c.units)) c.units = [];
      c.units = c.units.map((unit) => {
        const u = unit && typeof unit === "object" ? unit : {};
        u.title = normalize(u.title || u.name || "未設定の単元");
        if (!Array.isArray(u.questions)) u.questions = [];
        if (u.isVisible === undefined && u.is_visible !== undefined) {
          u.isVisible = Boolean(u.is_visible);
        }
        if (u.isVisible === undefined) u.isVisible = true;
        u.questions = u.questions.map(normalizeQuestion);
        return u;
      });
      return c;
    });

    return safe;
  }

  function normalizeQuestion(question) {
    const q = question && typeof question === "object" ? { ...question } : {};
    q.type = normalizeQuestionType(q.type);
    q.question = String(q.question ?? q.text ?? "");
    q.choices = Array.isArray(q.choices) ? q.choices.map(normalize).filter(Boolean) : [];

    if (Array.isArray(q.correctAnswers) && !Array.isArray(q.answers)) {
      q.answers = q.correctAnswers;
    }

    if (q.type === "choice" || q.type === "ox") {
      if (q.answer === undefined && Array.isArray(q.answers) && q.answers.length) {
        q.answer = q.answers[0];
      }
      q.answer = normalize(q.answer || "");
    } else {
      if (!Array.isArray(q.answers)) {
        q.answers = q.answer ? [q.answer] : [];
      }
      q.answers = q.answers.map(normalize);
    }

    if (q.type === "fill_multi" || q.type === "image_fill") {
      const n = Number(q.blankCount || q.blanks || 0);
      if (Number.isFinite(n) && n > 0) q.blankCount = n;
    }

    return q;
  }

  function getCorrectAnswers(q) {
    if (!q) return [];
    if (Array.isArray(q.correctAnswers)) return q.correctAnswers.map(normalize);
    if (Array.isArray(q.answers)) return q.answers.map(normalize);
    if (q.answer) return [normalize(q.answer)];
    return [];
  }

  function getFillMultiBlanks(questionText) {
    const text = String(questionText || "");
    const matches = text.match(/（\s*）|\(\s*\)|＿+|_{2,}/g) || [];
    return matches.length;
  }

  function getQuestionBlankCount(q) {
    if (!q) return 0;
    const fromField = Number(q.blankCount) || Number(q.blanks) || 0;
    const fromQuestion = q.type === "fill_multi" ? getFillMultiBlanks(q.question) : 0;
    const fromAnswers = getCorrectAnswers(q).length;
    return Math.max(fromField, fromQuestion, fromAnswers, 1);
  }

  function decorateFillMultiQuestion(questionText) {
    let idx = 0;
    return String(questionText || "").replace(/（\s*）|\(\s*\)|＿+|_{2,}/g, () => {
      idx += 1;
      return `（${toCircledNumber(idx)}）`;
    });
  }

  function beep(ok) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = "sine";
      o.frequency.value = ok ? 880 : 220;
      o.start();
      g.gain.setValueAtTime(0.12, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.18 : 0.32));
      o.stop(ctx.currentTime + (ok ? 0.18 : 0.32));
    } catch (_) {}
  }

  async function parseJsonSafe(response) {
    try {
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  async function apiJson(url, options = {}, fallbackMessage = "APIエラー") {
    const response = await fetch(url, options);
    const data = await parseJsonSafe(response);

    if (!response.ok) {
      const parts = [];
      if (data?.error) parts.push(`error=${data.error}`);
      if (data?.message) parts.push(`message=${data.message}`);
      if (data?.body) parts.push(`body=${data.body}`);
      const detail = parts.length ? `: ${parts.join(" / ")}` : "";
      throw new Error(`${fallbackMessage} (status=${response.status})${detail}`);
    }

    return data;
  }

  async function loadData(options = {}) {
    const admin = Boolean(options.admin);
    const skipRender = Boolean(options.skipRender || options.stopRender);

    try {
      const res = await fetch(`${API_BASE}/api/questions?ts=${Date.now()}&admin=${admin ? "1" : "0"}`);
      if (!res.ok) throw new Error(`APIエラー: ${res.status}`);
      db = ensureDbShape(await res.json());
      if (!skipRender) renderCourses();
    } catch (error) {
      console.error(error);
      db = ensureDbShape(null);
      app.innerHTML = `
        <div class="error-box">
          <h2>データ読み込みエラー</h2>
          <p>${esc(error?.message || error)}</p>
          <button type="button" onclick="loadData()">再試行</button>
          <button type="button" onclick="renderAdmin()">管理画面を開く</button>
        </div>
      `;
    }
  }

  function renderCourses() {
    view = "home";
    db = ensureDbShape(db);

    if (db.courses.length === 0) {
      app.innerHTML = `
        <div class="topbar">
          <button type="button" onclick="renderAdmin()">⚙ 管理</button>
        </div>
        <h1>${esc(db.appTitle || "カイゴクイズ")}</h1>
        <p>問題はまだありません。管理画面から科目・単元・問題を追加してください。</p>
      `;
      return;
    }

    let html = `
      <div class="topbar">
        <button type="button" onclick="renderAdmin()">⚙ 管理</button>
      </div>
      <h1>${esc(db.appTitle || "カイゴクイズ")}</h1>
      <p>科目を選択してください</p>
      <div class="list">
    `;

    db.courses.forEach((course, i) => {
      const visibleUnits = (course.units || []).filter((u) => u.isVisible !== false);
      const count = visibleUnits.reduce((sum, u) => sum + (u.questions?.length || 0), 0);
      html += `
        <button type="button" class="card" onclick="renderUnits(${i})">
          <span>${esc(course.title)}</span>
          <small>${count}問</small>
          <b>›</b>
        </button>
      `;
    });

    html += `</div>`;
    app.innerHTML = html;
  }

  function renderUnits(ci = 0) {
    view = "units";
    db = ensureDbShape(db);

    if (db.courses.length === 0) {
      renderCourses();
      return;
    }

    courseIndex = Math.max(0, Math.min(ci, db.courses.length - 1));
    const course = db.courses[courseIndex];

    let html = `
      <div class="topbar">
        <button type="button" onclick="renderAdmin()">⚙ 管理</button>
        <button type="button" onclick="renderCourses()">戻る</button>
      </div>
      <h1>${esc(course.title)}</h1>
      <p>${esc(db.appTitle || "カイゴクイズ")}</p>
      <p>単元を選択してください</p>
      <div class="list">
    `;

    let visibleCount = 0;
    (course.units || []).forEach((unit, i) => {
      if (unit.isVisible === false) return;
      visibleCount += 1;
      html += `
        <button type="button" class="card" onclick="startQuiz(${courseIndex}, ${i})">
          <span>${esc(unit.title)}</span>
          <small>${unit.questions?.length || 0}問</small>
          <b>›</b>
        </button>
      `;
    });

    if (visibleCount === 0) {
      html += `<p>表示中の単元がありません。</p>`;
    }

    html += `</div>`;
    app.innerHTML = html;
  }

  function startQuiz(ci, ui) {
    courseIndex = ci;
    unitIndex = ui;
    questionIndex = 0;
    lastResultShown = false;

    const unit = db?.courses?.[courseIndex]?.units?.[unitIndex];
    if (!unit || !Array.isArray(unit.questions) || unit.questions.length === 0) {
      alert("この単元には問題がありません。");
      renderUnits(courseIndex);
      return;
    }

    renderQuestion();
  }

  function currentQuestion() {
    return db?.courses?.[courseIndex]?.units?.[unitIndex]?.questions?.[questionIndex] || null;
  }

  function renderQuestion() {
    const unit = db?.courses?.[courseIndex]?.units?.[unitIndex];
    const q = currentQuestion();

    if (!unit || !q) {
      renderUnits(courseIndex);
      return;
    }

    const total = unit.questions.length;
    const questionImage = normalize(q.imageData || q.imageUrl || q.image || "");

    let html = `
      <div class="topbar">
        <button type="button" onclick="renderUnits(${courseIndex})">単元へ</button>
      </div>
      <div class="quiz-head">
        <h2>${esc(unit.title)}</h2>
        <p>${questionIndex + 1} / ${total}</p>
        <span class="badge">${esc(labelType(q.type))}</span>
      </div>
    `;

    if (questionImage) {
      html += `
        <div class="question-image-wrap">
          <img class="question-image" src="${esc(questionImage)}" alt="問題画像" onerror="this.outerHTML='<p>画像を表示できません。問題を作成者に確認してください。</p>'">
        </div>
      `;
    }

    if (q.question) {
      html += `
        <div class="question-text">
          ${esc(q.type === "fill_multi" ? decorateFillMultiQuestion(q.question) : q.question)}
        </div>
      `;
    }

    if (q.type === "fill") {
      html += `
        <input id="answerInput" class="answer-input" type="text" placeholder="答えを入力してEnter">
        <button type="button" onclick="checkFill()">回答</button>
      `;
    } else if (q.type === "fill_multi" || q.type === "image_fill") {
      const blankCount = getQuestionBlankCount(q);
      for (let i = 0; i < blankCount; i += 1) {
        html += `
          <div class="fill-multi-row">
            <label>${esc(toCircledNumber(i + 1))} アンサー</label>
            <input id="answerInput${i}" class="answer-input" type="text" placeholder="${esc(toCircledNumber(i + 1))}を入力">
          </div>
        `;
      }
      html += `
        <button type="button" onclick="${q.type === "image_fill" ? "checkImageFill()" : "checkFillMulti()"}">回答</button>
      `;
    } else if (q.type === "ox") {
      html += `
        <div class="choices">
          <button type="button" onclick="checkSingle('○')">○</button>
          <button type="button" onclick="checkSingle('×')">×</button>
        </div>
      `;
    } else if (q.type === "choice") {
      html += `<div class="choices">`;
      (q.choices || []).forEach((choice) => {
        html += `<button type="button" onclick="checkSingle('${esc(choice)}')">${esc(choice)}</button>`;
      });
      html += `</div>`;
    } else if (q.type === "multi") {
      html += `<div class="choices">`;
      (q.choices || []).forEach((choice, i) => {
        html += `
          <label class="choice-line">
            <input type="checkbox" value="${esc(choice)}">
            ${esc(choice)}
          </label>
        `;
      });
      html += `
        </div>
        <button type="button" onclick="checkMulti()">回答</button>
      `;
    } else {
      html += `<p>未対応の問題形式です。</p>`;
    }

    app.innerHTML = html;

    const input = document.getElementById("answerInput") || document.getElementById("answerInput0");
    if (input) {
      input.focus();
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        if (q.type === "fill") checkFill();
        if (q.type === "fill_multi") checkFillMulti();
        if (q.type === "image_fill") checkImageFill();
      });
    }
  }

  function showResult(ok, ans) {
    if (lastResultShown) return;
    lastResultShown = true;
    beep(ok);

    const box = document.createElement("div");
    box.className = `result ${ok ? "ok" : "ng"}`;
    box.innerHTML = `
      <h3>${ok ? "○ 正解" : "× 不正解"}</h3>
      <p>正解：${esc(Array.isArray(ans) ? ans.join("、") : ans)}</p>
      <button type="button" onclick="nextQuestion()">次へ</button>
    `;
    app.appendChild(box);
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function checkFill() {
    const q = currentQuestion();
    const val = normalizeForCompare(document.getElementById("answerInput")?.value || "");
    const answers = getCorrectAnswers(q);
    const ok = val !== "" && answers.some((a) => normalizeForCompare(a) === val);
    showResult(ok, answers);
  }

  function checkSingle(value) {
    const q = currentQuestion();
    const ok = normalizeForCompare(q?.answer) === normalizeForCompare(value);
    showResult(ok, q?.answer || "");
  }

  function checkMulti() {
    const q = currentQuestion();
    const checked = [...document.querySelectorAll("input[type=checkbox]:checked")]
      .map((x) => normalizeForCompare(x.value))
      .sort();
    const answers = getCorrectAnswers(q).map(normalizeForCompare).sort();
    showResult(JSON.stringify(checked) === JSON.stringify(answers), getCorrectAnswers(q));
  }

  function checkFillMulti() {
    checkMultiTextAnswers();
  }

  function checkImageFill() {
    checkMultiTextAnswers();
  }

  function checkMultiTextAnswers() {
    const q = currentQuestion();
    const answers = getCorrectAnswers(q);
    const blankCount = getQuestionBlankCount(q);
    const results = [];

    for (let i = 0; i < blankCount; i += 1) {
      const input = document.getElementById(`answerInput${i}`);
      const val = normalizeForCompare(input ? input.value : "");
      const ans = normalizeForCompare(answers[i] || "");
      const correct = val !== "" && ans !== "" && val === ans;
      results.push({ index: i + 1, correct });
    }

    showMultiInputJudges(results);
    showMultiResult(results, answers);
  }

  function showMultiInputJudges(results) {
    results.forEach((r, i) => {
      const input = document.getElementById(`answerInput${i}`);
      const row = input?.closest(".fill-multi-row");
      if (!row) return;

      let badge = row.querySelector(".answer-judge");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "answer-judge";
        row.appendChild(badge);
      }

      badge.textContent = r.correct ? "○" : "×";
      badge.classList.toggle("ok", r.correct);
      badge.classList.toggle("ng", !r.correct);
    });
  }

  function showMultiResult(results, answers) {
    if (lastResultShown) return;
    lastResultShown = true;

    const wrongCount = results.filter((r) => !r.correct).length;
    const allCorrect = wrongCount === 0;
    beep(allCorrect);

    const box = document.createElement("div");
    box.className = `result ${allCorrect ? "ok" : "ng"}`;
    box.innerHTML = `
      <h3>${allCorrect ? "○ 正解！" : "× 不正解です"}</h3>
      <p>${allCorrect ? "全問正解です。" : `${results.length}問中${wrongCount}問不正解です。`}</p>
      <p>正解：${esc(Array.isArray(answers) ? answers.join("、") : answers)}</p>
      <button type="button" onclick="nextQuestion()">次へ</button>
    `;
    app.appendChild(box);
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function nextQuestion() {
    const unit = db?.courses?.[courseIndex]?.units?.[unitIndex];
    if (!unit) {
      renderUnits(courseIndex);
      return;
    }

    questionIndex += 1;
    lastResultShown = false;

    if (questionIndex >= unit.questions.length) {
      app.innerHTML = `
        <h2>終了</h2>
        <p>${esc(unit.title)} が終わりました。</p>
        <button type="button" onclick="startQuiz(${courseIndex}, ${unitIndex})">もう一度</button>
        <button type="button" onclick="renderUnits(${courseIndex})">単元へ</button>
      `;
      return;
    }

    renderQuestion();
  }

  async function renderAdmin() {
    view = "admin";
    await loadData({ admin: true, skipRender: true });
    db = ensureDbShape(db);

    if (db.courses.length === 0) {
      db.courses.push({
        title: "新しい科目",
        units: [{ title: "新しい単元", isVisible: true, questions: [] }],
      });
    }

    if (courseIndex < 0 || courseIndex >= db.courses.length) courseIndex = 0;

    const course = db.courses[courseIndex];
    if (!Array.isArray(course.units)) course.units = [];
    if (course.units.length === 0) {
      course.units.push({ title: "新しい単元", isVisible: true, questions: [] });
    }

    if (unitIndex < 0 || unitIndex >= course.units.length) unitIndex = 0;

    const unit = course.units[unitIndex];
    if (!Array.isArray(unit.questions)) unit.questions = [];

    let html = `
      <div class="admin">
        <h1>管理画面</h1>
        <p>問題と答えの編集ができます。編集後は保存してください。</p>
        <div class="admin-actions">
          <button type="button" onclick="renderCourses()">戻る</button>
          <button type="button" onclick="downloadJson()">JSON出力</button>
          <button type="button" onclick="importJson()">JSON読込</button>
          <button type="button" onclick="addCoursePrompt()">科目追加</button>
          <button type="button" onclick="addUnitPrompt()">単元追加</button>
          <button type="button" onclick="renameCourse()">科目名変更</button>
          <button type="button" onclick="saveLocalData(true)">保存</button>
          <button type="button" onclick="replaceToInitialData()">最新データ再読込</button>
        </div>

        <h2>科目</h2>
        <div class="course-tabs">
    `;

    db.courses.forEach((c, i) => {
      html += `
        <button type="button" class="${i === courseIndex ? "active" : ""}" onclick="selectCourse(${i})">
          ${esc(c.title)}
        </button>
      `;
    });

    html += `
        </div>

        <h2>単元</h2>
        <div class="admin-list">
    `;

    course.units.forEach((u, i) => {
      const visibilityLabel = u.isVisible === false ? "非表示" : "表示中";
      html += `
        <div class="admin-row ${i === unitIndex ? "active" : ""}">
          <div>
            <b>${esc(u.title)}</b>（${visibilityLabel}）
            <small>${u.questions?.length || 0}問</small>
          </div>
          <div>
            <button type="button" onclick="selectUnit(${i})">選択</button>
            <button type="button" onclick="toggleUnitVisibility(${i})">${u.isVisible === false ? "表示する" : "非表示にする"}</button>
            <button type="button" onclick="renameUnit(${i})">名称変更</button>
            <button type="button" onclick="deleteUnit(${i})">削除</button>
          </div>
        </div>
      `;
    });

    html += `
        </div>

        <h2>${esc(unit.title)}</h2>
        <p>${unit.questions.length}問</p>
        <button type="button" onclick="openAddQuestion()">＋ 問題追加</button>
        <div class="admin-list">
    `;

    unit.questions.forEach((q, i) => {
      html += `
        <div class="admin-row">
          <div>
            <b>${esc(labelType(q.type))} ${i + 1}.</b>
            ${esc(q.question || "(画像問題・問題文なし)")}
            <br>
            <small>正解：${esc(answerText(q))}</small>
          </div>
          <div>
            <button type="button" onclick="moveQuestion(${i}, -1)">上</button>
            <button type="button" onclick="moveQuestion(${i}, 1)">下</button>
            <button type="button" onclick="editQuestion(${i})">編集</button>
            <button type="button" onclick="deleteQuestion(${i})">削除</button>
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;

    app.innerHTML = html;
  }

  function answerText(q) {
    if (!q) return "";
    if (q.type === "choice" || q.type === "ox") return q.answer || "";
    return getCorrectAnswers(q).join("、");
  }

  function selectCourse(i) {
    courseIndex = i;
    unitIndex = 0;
    renderAdmin();
  }

  function selectUnit(i) {
    unitIndex = i;
    renderAdmin();
  }

  async function saveLocalData(showAlert = true) {
    await syncAllQuestionsToApi();
    if (showAlert) alert("保存しました");
  }

  async function replaceToInitialData() {
    if (!confirm("最新データを再読み込みしますか？未保存の編集は破棄されます。")) return;
    await loadData({ admin: true, skipRender: true });
    alert("最新データを再読み込みしました");
    renderAdmin();
  }

  async function addCoursePrompt() {
    const title = prompt("科目名");
    if (!normalize(title)) return;

    db.courses.push({
      title: normalize(title),
      units: [{ title: "新しい単元", isVisible: true, questions: [] }],
    });

    courseIndex = db.courses.length - 1;
    unitIndex = 0;

    try {
      await saveLocalData(false);
    } catch (error) {
      console.error(error);
      alert(`保存に失敗しました: ${error?.message || error}`);
    }

    renderAdmin();
  }

  async function addUnitPrompt() {
    const title = prompt("単元名");
    if (!normalize(title)) return;

    db.courses[courseIndex].units.push({
      title: normalize(title),
      isVisible: true,
      questions: [],
    });

    unitIndex = db.courses[courseIndex].units.length - 1;

    try {
      await saveLocalData(false);
    } catch (error) {
      console.error(error);
      alert(`保存に失敗しました: ${error?.message || error}`);
    }

    renderAdmin();
  }

  async function renameCourse() {
    const course = db.courses[courseIndex];
    const title = prompt("科目名", course.title);
    if (!normalize(title)) return;

    course.title = normalize(title);

    try {
      await saveLocalData(false);
    } catch (error) {
      console.error(error);
      alert(`保存に失敗しました: ${error?.message || error}`);
    }

    renderAdmin();
  }

  async function renameUnit(i) {
    const unit = db.courses[courseIndex].units[i];
    const title = prompt("単元名", unit.title);
    if (!normalize(title)) return;

    unit.title = normalize(title);

    try {
      await saveLocalData(false);
    } catch (error) {
      console.error(error);
      alert(`保存に失敗しました: ${error?.message || error}`);
    }

    renderAdmin();
  }

  async function deleteUnit(i) {
    if (!confirm("この単元を削除しますか？")) return;

    db.courses[courseIndex].units.splice(i, 1);
    unitIndex = Math.max(0, Math.min(unitIndex, db.courses[courseIndex].units.length - 1));

    try {
      await saveLocalData(false);
    } catch (error) {
      console.error(error);
      alert(`保存に失敗しました: ${error?.message || error}`);
    }

    renderAdmin();
  }

  async function toggleUnitVisibility(index) {
    const course = db.courses[courseIndex];
    const unit = course?.units?.[index];
    if (!unit) return;

    const nextVisible = unit.isVisible === false;

    try {
      if (unit.id) {
        await apiJson(
          `${API_BASE}/api/units/${encodeURIComponent(unit.id)}/visibility`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ is_visible: nextVisible }),
          },
          "単元表示状態の更新に失敗しました"
        );
      }

      unit.isVisible = nextVisible;
      await saveLocalData(false);
      renderAdmin();
    } catch (error) {
      console.error(error);
      alert(`単元表示状態の更新に失敗しました: ${error?.message || error}`);
    }
  }

  function openAddQuestion() {
    editQuestion(null);
  }

  function getQuestionForEdit(index) {
    if (index === null) {
      return {
        type: "fill",
        question: "",
        choices: [],
        answers: [""],
        blankCount: 1,
      };
    }

    const unit = db.courses[courseIndex].units[unitIndex];
    return normalizeQuestion(unit.questions[index]);
  }

  function editQuestion(index) {
    const isNew = index === null;
    const unit = db.courses[courseIndex].units[unitIndex];
    const q = getQuestionForEdit(index);

    editingImageData = normalize(q.imageData || q.imageUrl || q.image || "");

    if (q.type === "choice" || q.type === "ox") {
      editAnswersCache = [normalize(q.answer || "")];
    } else {
      editAnswersCache = getCorrectAnswers(q);
    }

    const blankCount = q.type === "fill_multi" || q.type === "image_fill"
      ? getQuestionBlankCount(q)
      : Math.max(Number(q.blankCount) || editAnswersCache.length || 1, 1);

    const selected = (value) => normalizeQuestionType(q.type) === value ? "selected" : "";

    app.innerHTML = `
      <div class="admin-edit">
        <h1>${isNew ? "問題追加" : "問題編集"}</h1>
        <p>${esc(unit.title)}</p>
        <button type="button" onclick="renderAdmin()">戻る</button>

        <label>
          形式
          <select id="editType" onchange="toggleAnswerInputMode()">
            <option value="fill" ${selected("fill")}>記述</option>
            <option value="fill_multi" ${selected("fill_multi")}>空欄補充</option>
            <option value="image_fill" ${selected("image_fill")}>画像＋空欄補充</option>
            <option value="ox" ${selected("ox")}>○×</option>
            <option value="choice" ${selected("choice")}>選択</option>
            <option value="multi" ${selected("multi")}>複数選択</option>
          </select>
        </label>

        <label>
          問題文
          <textarea id="editQuestion" rows="5">${esc(q.question || "")}</textarea>
        </label>

        <div class="image-edit-block">
          <label>
            問題画像をアップ
            <input id="editImageFile" type="file" accept="image/jpeg,image/png,image/webp" style="display:none">
          </label>
          <button type="button" onclick="triggerImageSelect()">問題画像を選択</button>
          <div id="imageDropZone" class="drop-zone" onclick="triggerImageSelect()" ondragover="handleImageDragOver(event)" ondragleave="handleImageDragLeave(event)" ondrop="handleImageDrop(event)">
            ここに画像をドロップ、またはクリックして選択
          </div>
          <div id="editImagePreview" class="${editingImageData ? "" : "hidden"}">
            <p>問題画像プレビュー</p>
            <img id="editImagePreviewImg" src="${esc(editingImageData)}" alt="問題画像プレビュー">
            <button type="button" onclick="clearUploadedImage()">画像削除</button>
          </div>
        </div>

        <label>
          空欄数（空欄補充 / 画像＋空欄補充のみ）
          <input id="editBlankCount" type="number" min="1" max="20" value="${esc(blankCount)}" oninput="renderAnswerInputsByBlankCount()">
        </label>

        <label>
          選択肢（選択・複数選択のみ。1行に1つ）
          <textarea id="editChoices" rows="5">${esc((q.choices || []).join("\n"))}</textarea>
        </label>
        <div id="editChoicesTextActions">
          <button type="button" onclick="appendChoice()">選択肢追加</button>
          <button type="button" onclick="removeChoice()">選択肢削除</button>
        </div>

        <label id="editAnswersLabel">
          正解（1行に1つ。複数ある場合は順番に入力。○×は ○ または ×）
        </label>
        <textarea id="editAnswers" rows="5">${esc(q.type === "choice" || q.type === "ox" ? (q.answer || "") : getCorrectAnswers(q).join("\n"))}</textarea>
        <div id="editAnswersList" class="hidden"></div>

        <div id="editAnswersTextActions">
          <button type="button" onclick="appendAnswer()">正解追加</button>
          <button type="button" onclick="removeAnswer()">正解削除</button>
        </div>
        <div id="editAnswersMultiActions" class="hidden">
          <button type="button" onclick="appendFillMultiBlank()">空欄を1つ追加</button>
        </div>

        <button id="saveQuestionButton" type="button" onclick="saveQuestion(${isNew ? "null" : index})">保存</button>
      </div>
    `;

    initImageUploader();
    toggleAnswerInputMode();
    renderUploadedImagePreview();
  }

  function triggerImageSelect() {
    document.getElementById("editImageFile")?.click();
  }

  function handleImageDragOver(event) {
    event.preventDefault();
    document.getElementById("imageDropZone")?.classList.add("dragover");
  }

  function handleImageDragLeave(event) {
    event.preventDefault();
    document.getElementById("imageDropZone")?.classList.remove("dragover");
  }

  function handleImageDrop(event) {
    event.preventDefault();
    document.getElementById("imageDropZone")?.classList.remove("dragover");
    const file = event.dataTransfer?.files?.[0];
    if (file) loadQuestionImageFile(file);
  }

  function initImageUploader() {
    const input = document.getElementById("editImageFile");
    if (!input) return;

    input.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) loadQuestionImageFile(file);
    });
  }

  function isAllowedImageType(file) {
    const type = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    return ["image/jpeg", "image/png", "image/webp"].includes(type) || /\.(jpg|jpeg|png|webp)$/.test(name);
  }

  function loadQuestionImageFile(file) {
    if (!isAllowedImageType(file)) {
      alert("対応形式は jpg / jpeg / png / webp のみです");
      return;
    }

    uploadImageToApi(file)
      .then((url) => {
        editingImageData = url;
        renderUploadedImagePreview();
      })
      .catch((error) => {
        console.error(error);
        alert(error?.message || "画像アップロードに失敗しました");
      });
  }

  function renderUploadedImagePreview() {
    const preview = document.getElementById("editImagePreview");
    const img = document.getElementById("editImagePreviewImg");
    if (!preview || !img) return;

    if (editingImageData) {
      img.src = editingImageData;
      preview.classList.remove("hidden");
    } else {
      img.src = "";
      preview.classList.add("hidden");
    }
  }

  function clearUploadedImage() {
    editingImageData = "";
    const input = document.getElementById("editImageFile");
    if (input) input.value = "";
    renderUploadedImagePreview();
  }

  async function uploadImageToApi(file) {
    const form = new FormData();
    form.append("file", file);

    const res = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      body: form,
    });

    const json = await parseJsonSafe(res);

    if (!res.ok) {
      let message = "画像アップロードに失敗しました";
      if (json?.error) message += `: ${json.error}`;
      if (json?.message) message += `: ${json.message}`;
      throw new Error(message);
    }

    if (!json?.imageUrl) {
      throw new Error("画像URLの取得に失敗しました");
    }

    return json.imageUrl;
  }

  function appendLine(id, text = "") {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = el.value ? `${el.value}\n${text}` : text;
    el.focus();
  }

  function removeLastLine(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const lines = el.value.split("\n");
    lines.pop();
    el.value = lines.join("\n");
    el.focus();
  }

  function appendChoice() {
    appendLine("editChoices", "");
  }

  function removeChoice() {
    removeLastLine("editChoices");
  }

  function appendAnswer() {
    appendLine("editAnswers", "");
  }

  function removeAnswer() {
    removeLastLine("editAnswers");
  }

  function isMultiBlankType(type) {
    return type === "fill_multi" || type === "image_fill";
  }

  function syncAnswerCacheFromRenderedInputs() {
    const list = document.getElementById("editAnswersList");
    if (!list) return;

    const inputs = [...list.querySelectorAll("input[data-answer-index]")];
    inputs.forEach((input) => {
      const index = Number(input.dataset.answerIndex);
      if (Number.isFinite(index)) editAnswersCache[index] = normalize(input.value);
    });

    const text = document.getElementById("editAnswers");
    if (text) text.value = editAnswersCache.join("\n");
  }

  function renderAnswerInputsByBlankCount() {
    const typeEl = document.getElementById("editType");
    const list = document.getElementById("editAnswersList");
    const text = document.getElementById("editAnswers");
    const blankCountEl = document.getElementById("editBlankCount");

    if (!typeEl || !list || !text || !blankCountEl) return;
    if (!isMultiBlankType(typeEl.value)) return;

    const currentInputs = [...list.querySelectorAll("input[data-answer-index]")];
    if (currentInputs.length) {
      currentInputs.forEach((input) => {
        const index = Number(input.dataset.answerIndex);
        if (Number.isFinite(index)) editAnswersCache[index] = normalize(input.value);
      });
    } else if (text.value) {
      editAnswersCache = text.value.split("\n").map(normalize);
    }

    const requested = parseInt(blankCountEl.value, 10);
    const blankCount = Number.isFinite(requested) && requested > 0 ? requested : 1;

    blankCountEl.value = String(blankCount);
    editAnswersCache = editAnswersCache.slice(0, blankCount);
    while (editAnswersCache.length < blankCount) editAnswersCache.push("");

    let html = "";
    for (let i = 0; i < blankCount; i += 1) {
      html += `
        <div class="answer-edit-row">
          <label>アンサー${esc(toCircledNumber(i + 1))}</label>
          <input type="text" data-answer-index="${i}" value="${esc(editAnswersCache[i] || "")}" oninput="syncAnswerCacheFromInput(event)">
        </div>
      `;
    }

    list.innerHTML = html;
    text.value = editAnswersCache.join("\n");
  }

  function syncAnswerCacheFromInput(event) {
    const input = event?.target;
    if (!input) return;

    const index = Number(input.dataset.answerIndex);
    if (!Number.isFinite(index)) return;

    editAnswersCache[index] = normalize(input.value);

    const text = document.getElementById("editAnswers");
    if (text) text.value = editAnswersCache.join("\n");
  }

  function toggleAnswerInputMode() {
    const type = document.getElementById("editType")?.value;
    const list = document.getElementById("editAnswersList");
    const text = document.getElementById("editAnswers");
    const label = document.getElementById("editAnswersLabel");
    const textActions = document.getElementById("editAnswersTextActions");
    const multiActions = document.getElementById("editAnswersMultiActions");

    if (!list || !text || !label || !textActions || !multiActions) return;

    if (isMultiBlankType(type)) {
      if (text.value) editAnswersCache = text.value.split("\n").map(normalize);
      label.textContent = "正解（空欄ごとに入力）";
      text.classList.add("hidden");
      list.classList.remove("hidden");
      textActions.classList.add("hidden");
      multiActions.classList.remove("hidden");
      renderAnswerInputsByBlankCount();
      return;
    }

    syncAnswerCacheFromRenderedInputs();

    label.textContent = "正解（1行に1つ。複数ある場合は順番に入力。○×は ○ または ×）";
    list.classList.add("hidden");
    text.classList.remove("hidden");
    textActions.classList.remove("hidden");
    multiActions.classList.add("hidden");

    if (editAnswersCache.length) {
      text.value = editAnswersCache.filter((v) => v !== "").join("\n");
    }
  }

  function appendFillMultiBlank() {
    const question = document.getElementById("editQuestion");
    const blankCountEl = document.getElementById("editBlankCount");

    if (question) {
      question.value += "（ ）";
      question.focus();
    }

    const nextBlankCount = (Number(blankCountEl?.value) || 0) + 1;
    if (blankCountEl) blankCountEl.value = String(nextBlankCount);

    renderAnswerInputsByBlankCount();
  }

  function buildQuestionFromEditor(index) {
    const type = normalizeQuestionType(document.getElementById("editType")?.value);
    const question = normalize(document.getElementById("editQuestion")?.value);
    const choices = (document.getElementById("editChoices")?.value || "")
      .split("\n")
      .map(normalize)
      .filter(Boolean);

    let answers = (document.getElementById("editAnswers")?.value || "")
      .split("\n")
      .map(normalize)
      .filter((v) => v !== "");

    const blankCount = Math.max(Number(document.getElementById("editBlankCount")?.value) || 1, 1);

    if (isMultiBlankType(type)) {
      renderAnswerInputsByBlankCount();
      syncAnswerCacheFromRenderedInputs();
      answers = [...document.querySelectorAll("#editAnswersList input[data-answer-index]")]
        .map((input) => normalize(input.value));
    }

    if (type !== "image_fill" && !question) {
      throw new Error("問題文を入力してください");
    }

    if (type === "choice" || type === "multi") {
      if (choices.length === 0) throw new Error("選択肢を入力してください");
    }

    if (type === "fill_multi" || type === "image_fill") {
      if (answers.length !== blankCount) throw new Error("空欄数と正解数が一致していません");
      if (answers.some((a) => !a)) throw new Error("正解入力欄をすべて入力してください");
    } else if (answers.length === 0) {
      throw new Error("正解を入力してください");
    }

    if (type === "ox" && !["○", "×"].includes(answers[0])) {
      throw new Error("○×問題の正解は ○ または × で入力してください");
    }

    const unit = db.courses[courseIndex].units[unitIndex];
    const existing = index === null ? null : unit.questions[index];

    const q = {
      type,
      question,
    };

    if (existing?.id !== undefined && existing?.id !== null && String(existing.id).trim() !== "") {
      q.id = existing.id;
    }

    if (editingImageData) {
      q.imageUrl = editingImageData;
    }

    if (type === "choice") {
      q.choices = choices;
      q.answer = answers[0];
    } else if (type === "ox") {
      q.answer = answers[0];
    } else if (type === "multi") {
      q.choices = choices;
      q.answers = answers;
    } else if (type === "fill_multi" || type === "image_fill") {
      q.blankCount = blankCount;
      q.answers = answers;
    } else {
      q.answers = answers;
    }

    return q;
  }

  async function saveQuestion(index) {
    if (isSavingQuestion) return;

    const saveButton = document.getElementById("saveQuestionButton");
    isSavingQuestion = true;
    if (saveButton) saveButton.disabled = true;

    try {
      const unit = db.courses[courseIndex].units[unitIndex];
      const q = buildQuestionFromEditor(index);
      const sortOrder = index === null ? unit.questions.length : index;
      const payload = {
        ...q,
        course: db.courses[courseIndex].title,
        unit: unit.title,
        sortOrder,
      };

      if (q.id) {
        await apiJson(
          `${API_BASE}/api/questions/${encodeURIComponent(q.id)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          },
          "問題の更新に失敗しました"
        );
      } else {
        const saved = await apiJson(
          `${API_BASE}/api/questions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          },
          "問題の作成に失敗しました"
        );

        if (saved?.id !== undefined && saved?.id !== null) {
          q.id = saved.id;
        }
      }

      if (index === null) {
        unit.questions.push(q);
      } else {
        unit.questions[index] = q;
      }

      await loadData({ admin: true, skipRender: true });
      renderAdmin();
    } catch (error) {
      console.error(error);
      alert(`保存に失敗しました: ${error?.message || error}`);
    } finally {
      isSavingQuestion = false;
      if (saveButton) saveButton.disabled = false;
    }
  }

  async function deleteQuestion(i) {
    if (!confirm("この問題を削除しますか？")) return;

    const questions = db.courses[courseIndex].units[unitIndex].questions;
    const target = questions[i];

    try {
      if (target?.id !== undefined && target?.id !== null && String(target.id).trim() !== "") {
        await apiJson(
          `${API_BASE}/api/questions/${encodeURIComponent(String(target.id))}`,
          { method: "DELETE" },
          "問題の削除に失敗しました"
        );
      }

      questions.splice(i, 1);
      await loadData({ admin: true, skipRender: true });
      renderAdmin();
    } catch (error) {
      console.error(error);
      alert(`削除に失敗しました: ${error?.message || error}`);
    }
  }

  async function moveQuestion(i, dir) {
    const arr = db.courses[courseIndex].units[unitIndex].questions;
    const ni = i + dir;
    if (ni < 0 || ni >= arr.length) return;

    [arr[i], arr[ni]] = [arr[ni], arr[i]];

    try {
      await saveLocalData(false);
      renderAdmin();
    } catch (error) {
      console.error(error);
      alert(`保存に失敗しました: ${error?.message || error}`);
    }
  }

  async function syncAllQuestionsToApi() {
    if (isSyncingAll) return;
    isSyncingAll = true;

    try {
      const current = await apiJson(`${API_BASE}/api/questions?admin=1`, {}, "問題一覧の取得に失敗しました");
      const currentIds = new Set();

      (current?.courses || []).forEach((course) => {
        (course.units || []).forEach((unit) => {
          (unit.questions || []).forEach((question) => {
            if (question?.id !== undefined && question?.id !== null) currentIds.add(String(question.id));
          });
        });
      });

      const incomingIds = new Set();

      for (const course of db.courses || []) {
        for (const unit of course.units || []) {
          for (let i = 0; i < (unit.questions || []).length; i += 1) {
            const q = normalizeQuestion(unit.questions[i]);
            unit.questions[i] = q;

            const payload = {
              ...q,
              course: course.title,
              unit: unit.title,
              sortOrder: i,
            };

            if (q.id !== undefined && q.id !== null && String(q.id).trim() !== "") {
              incomingIds.add(String(q.id));
              await apiJson(
                `${API_BASE}/api/questions/${encodeURIComponent(String(q.id))}`,
                {
                  method: "PUT",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(payload),
                },
                "問題の更新に失敗しました"
              );
            } else {
              const saved = await apiJson(
                `${API_BASE}/api/questions`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(payload),
                },
                "問題の作成に失敗しました"
              );

              if (saved?.id !== undefined && saved?.id !== null) {
                q.id = saved.id;
                incomingIds.add(String(q.id));
              }
            }
          }
        }
      }

      for (const id of currentIds) {
        if (!incomingIds.has(id)) {
          await apiJson(
            `${API_BASE}/api/questions/${encodeURIComponent(id)}`,
            { method: "DELETE" },
            "問題の削除に失敗しました"
          );
        }
      }

      await loadData({ admin: true, skipRender: true });
    } finally {
      isSyncingAll = false;
    }
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "questions.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJson() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";

    input.onchange = (event) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          db = ensureDbShape(JSON.parse(reader.result));
          courseIndex = 0;
          unitIndex = 0;
          await saveLocalData(false);
          renderAdmin();
        } catch (error) {
          console.error(error);
          alert(`JSON読込に失敗しました: ${error?.message || error}`);
        }
      };

      reader.readAsText(file);
    };

    input.click();
  }

  Object.assign(window, {
    loadData,
    renderCourses,
    renderUnits,
    startQuiz,
    renderQuestion,
    checkFill,
    checkFillMulti,
    checkImageFill,
    checkSingle,
    checkMulti,
    nextQuestion,
    renderAdmin,
    selectCourse,
    selectUnit,
    saveLocalData,
    replaceToInitialData,
    addCoursePrompt,
    addUnitPrompt,
    renameCourse,
    renameUnit,
    deleteUnit,
    toggleUnitVisibility,
    openAddQuestion,
    editQuestion,
    triggerImageSelect,
    handleImageDragOver,
    handleImageDragLeave,
    handleImageDrop,
    clearUploadedImage,
    appendChoice,
    removeChoice,
    appendAnswer,
    removeAnswer,
    renderAnswerInputsByBlankCount,
    syncAnswerCacheFromInput,
    toggleAnswerInputMode,
    appendFillMultiBlank,
    saveQuestion,
    deleteQuestion,
    moveQuestion,
    downloadJson,
    importJson,
  });

  loadData();
})();
