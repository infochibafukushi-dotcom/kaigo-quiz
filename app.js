let db = null;
let view = "home";
let courseIndex = 0;
let unitIndex = 0;
let questionIndex = 0;
let lastResultShown = false;
let editingImageData = "";

const app = document.getElementById("app");
const API_BASE = window.KAIGO_QUIZ_API_BASE || "https://kaigo-quiz-save.info-chibafukushi.workers.dev";

async function loadData(){
  try{
    const res = await fetch(`${API_BASE}/api/questions?ts=` + Date.now());
    if(!res.ok) throw new Error(`APIエラー: ${res.status}`);
    db = ensureDbShape(await res.json());
    renderUnits(0);
  }catch(e){
    db = ensureDbShape(null);
    app.innerHTML = `
      <div class="card">
        <h1>データ読み込みエラー</h1>
        <p class="sub">${esc(String(e?.message || e))}</p>
        <button onclick="loadData()">再試行</button>
        <button class="secondary" onclick="renderAdmin()">管理画面を開く</button>
      </div>
    `;
  }

  renderUnits(0);
}

function ensureDbShape(data){
  const safe = data && typeof data === "object" ? data : {};
  if(!Array.isArray(safe.courses)) safe.courses = [];
  safe.appTitle = normalize(safe.appTitle || "カイゴクイズ");
  return safe;
}

async function saveLocalData(showAlert = true){
  await syncAllQuestionsToApi();
  if(showAlert){
    alert("保存しました");
  }
}

async function resetToInitialData(){
  if(!confirm("初期データに戻しますか？")) return;
  await loadData();
  alert("最新データを再読み込みしました");
}

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function normalize(s){
  return String(s ?? "").trim();
}

function normalizeForCompare(s){
  return normalize(s).normalize("NFKC").toLowerCase();
}

function beep(ok){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.value = ok ? 880 : 220;
    o.start();
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.18 : 0.32));
    o.stop(ctx.currentTime + (ok ? 0.18 : 0.32));
  }catch(e){}
}

function labelType(t){
  return {
    fill:"記述",
    fill_multi:"記述（複数空欄）",
    image_fill:"画像穴埋め",
    ox:"○×",
    choice:"選択",
    multi:"複数選択"
  }[t] || t;
}


function getFillMultiBlanks(question){
  const text = String(question || "");
  const blankRegex = /（\s*　+\s*）/g;
  const matches = text.match(blankRegex) || [];
  return matches.length;
}

function getQuestionBlankCount(q){
  if(!q) return 0;
  const fromField = Number(q.blankCount) || Number(q.blanks) || 0;
  const fromQuestion = q.type === "fill_multi" ? getFillMultiBlanks(q.question) : 0;
  const fromAnswers = getCorrectAnswers(q).length;
  return Math.max(fromField, fromQuestion, fromAnswers);
}

function decorateFillMultiQuestion(question){
  const text = String(question || "");
  let idx = 0;
  return text.replace(/（\s*　+\s*）/g, () => {
    idx += 1;
    return `（${toCircledNumber(idx)}）`;
  });
}

function toCircledNumber(n){
  const base = 0x2460;
  if(n >= 1 && n <= 20) return String.fromCharCode(base + (n - 1));
  return `${n}`;
}

function renderUnits(ci = 0){
  db = ensureDbShape(db);
  if(db.courses.length === 0){
    app.innerHTML = `
      <div class="topbar">
        <div class="left-actions">
          <button class="secondary" onclick="renderAdmin()">⚙ 管理</button>
        </div>
      </div>
      <div class="card">
        <h1 class="page-title">${esc(db.appTitle || "カイゴクイズ")}</h1>
        <p class="sub">問題がまだありません。管理画面から大分類・単元・問題を追加してください。</p>
      </div>
    `;
    return;
  }
  courseIndex = ci;
  const c = db.courses[ci];
  let html = `
    <div class="topbar">
      <div class="left-actions">
        <button class="secondary" onclick="renderAdmin()">⚙ 管理</button>
      </div>
      <div class="right-actions">
        <button class="secondary" onclick="renderUnits(${ci})">戻る</button>
      </div>
    </div>
    <div class="card">
      <h1 class="page-title">${esc(c.title)}</h1>
      <div class="sub">${esc(db.appTitle || "カイゴクイズ")}</div>
      <p class="sub">単元を選択してください</p>
    </div>
  `;

  c.units.forEach((u, i)=>{
    html += `
      <div class="card unit-card" onclick="startQuiz(${ci},${i})">
        <div>
          <div class="unit-title">${esc(u.title)}</div>
          <div class="sub">${u.questions.length}問</div>
        </div>
        <div class="sub">›</div>
      </div>
    `;
  });

  app.innerHTML = html;
}

function startQuiz(ci, ui){
  courseIndex = ci;
  unitIndex = ui;
  questionIndex = 0;
  lastResultShown = false;
  renderQuestion();
}

function currentQuestion(){
  return db.courses[courseIndex].units[unitIndex].questions[questionIndex];
}

function renderQuestion(){
  const unit = db.courses[courseIndex].units[unitIndex];
  const q = currentQuestion();
  const percent = Math.round((questionIndex / unit.questions.length) * 100);

  const questionImage = normalize(q.imageData || q.imageUrl || q.image || "");
  let html = `
    <div class="topbar">
      <div>
        <h1 class="page-title">${esc(unit.title)}</h1>
        <div class="sub">${questionIndex + 1} / ${unit.questions.length}</div>
      </div>
      <button class="secondary" onclick="renderUnits(${courseIndex})">単元へ</button>
    </div>
    <div class="progress"><div class="bar" style="width:${percent}%"></div></div>
    <div class="card">
      <span class="badge ${esc(q.type)}">${esc(labelType(q.type))}</span>
      ${questionImage ? `<div class="quiz-image-wrap"><img class="quiz-image" src="${esc(questionImage)}" alt="問題画像" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"><div class="quiz-image-fallback" style="display:none;">画像を表示できません。問題を作成者に確認してください。</div></div>` : ""}
      ${q.question ? `<div class="quiz-question">${esc(q.type === "fill_multi" ? decorateFillMultiQuestion(q.question) : q.question)}</div>` : ""}
  `;

  if(q.type === "fill"){
    html += `<input id="answerInput" autocomplete="off" placeholder="答えを入力してEnter"><button onclick="checkFill()">回答</button>`;
  }else if(q.type === "fill_multi"){
    const blankCount = getQuestionBlankCount(q);
    for(let i = 0; i < blankCount; i++){
      html += `<label class="fill-multi-row">${esc(toCircledNumber(i + 1))}アンサー<input id="answerInput${i}" autocomplete="off" placeholder="${esc(toCircledNumber(i + 1))}アンサー"></label>`;
    }
    html += `<button onclick="checkFillMulti()">回答</button>`;
  }else if(q.type === "image_fill"){
    const blankCount = getQuestionBlankCount(q);
    for(let i = 0; i < blankCount; i++){
      html += `<label class="fill-multi-row">${esc(toCircledNumber(i + 1))}<input id="answerInput${i}" autocomplete="off" placeholder="${esc(toCircledNumber(i + 1))}を入力"></label>`;
    }
    html += `<button onclick="checkImageFill()">回答</button>`;
  }else if(q.type === "ox"){
    html += `<div class="row"><button onclick="checkSingle('○')">○</button><button onclick="checkSingle('×')">×</button></div>`;
  }else if(q.type === "choice"){
    q.choices.forEach(ch=>{
      html += `<button class="choice-btn" onclick='checkSingle(${JSON.stringify(ch)})'>${esc(ch)}</button>`;
    });
  }else if(q.type === "multi"){
    q.choices.forEach(ch=>{
      html += `<label class="check-row"><input type="checkbox" value="${esc(ch)}">${esc(ch)}</label>`;
    });
    html += `<button onclick="checkMulti()">回答</button>`;
  }

  html += `</div>`;
  app.innerHTML = html;

  const input = document.getElementById("answerInput") || document.getElementById("answerInput0");
  if(input){
    input.focus();
    input.addEventListener("keydown", e => {
      if(e.key === "Enter"){
        if(q.type === "fill") checkFill();
        if(q.type === "fill_multi") checkFillMulti();
        if(q.type === "image_fill") checkImageFill();
      }
    });
  }
}

function getCorrectAnswers(q){
  if(Array.isArray(q.correctAnswers)) return q.correctAnswers;
  if(Array.isArray(q.answers)) return q.answers;
  return q.answer ? [q.answer] : [];
}

function showResult(ok, ans){
  if(lastResultShown) return;
  lastResultShown = true;
  beep(ok);

  const box = document.createElement("div");
  box.className = `result ${ok ? "ok" : "ng"}`;
  box.innerHTML = `
    ${ok ? "○ 正解" : "× 不正解"}
    <div class="answer">正解：${esc(Array.isArray(ans) ? ans.join("、") : ans)}</div>
    <button onclick="nextQuestion()">次へ</button>
  `;
  app.appendChild(box);
  box.scrollIntoView({behavior:"smooth", block:"center"});
}

function checkFill(){
  const q = currentQuestion();
  const val = normalizeForCompare(document.getElementById("answerInput").value);
  const answers = getCorrectAnswers(q);
  const ok = val !== "" && answers.some(a => normalizeForCompare(a) === val);
  showResult(ok, answers);
}

function checkFillMulti(){
  const q = currentQuestion();
  const answers = getCorrectAnswers(q);
  const blankCount = getQuestionBlankCount(q);
  const results = [];

  for(let i = 0; i < blankCount; i++){
    const input = document.getElementById(`answerInput${i}`);
    const val = normalizeForCompare(input ? input.value : "");
    const ans = normalizeForCompare(answers[i] || "");
    const correct = val !== "" && ans !== "" && val === ans;
    results.push({index:i + 1, correct});
  }
  showMultiInputJudges(results);
  showMultiResult(results, answers);
}

function checkImageFill(){
  const q = currentQuestion();
  const answers = getCorrectAnswers(q);
  const blankCount = getQuestionBlankCount(q);
  const results = [];
  for(let i = 0; i < blankCount; i++){
    const input = document.getElementById(`answerInput${i}`);
    const val = normalizeForCompare(input ? input.value : "");
    const ans = normalizeForCompare(answers[i] || "");
    const correct = val !== "" && ans !== "" && val === ans;
    results.push({index:i + 1, correct});
  }
  showMultiInputJudges(results);
  showMultiResult(results, answers);
}

function checkSingle(v){
  const q = currentQuestion();
  showResult(normalizeForCompare(q.answer) === normalizeForCompare(v), q.answer);
}

function checkMulti(){
  const q = currentQuestion();
  const checked = [...document.querySelectorAll("input[type=checkbox]:checked")]
    .map(x=>normalizeForCompare(x.value))
    .sort();
  const ans = q.answers.map(normalizeForCompare).sort();
  showResult(JSON.stringify(checked) === JSON.stringify(ans), q.answers);
}

function showMultiInputJudges(results){
  results.forEach((r, i) => {
    const input = document.getElementById(`answerInput${i}`);
    const row = input?.closest(".fill-multi-row");
    if(!row) return;
    let badge = row.querySelector(".answer-judge");
    if(!badge){
      badge = document.createElement("span");
      badge.className = "answer-judge";
      row.appendChild(badge);
    }
    badge.textContent = r.correct ? "○" : "×";
    badge.classList.toggle("ok", r.correct);
    badge.classList.toggle("ng", !r.correct);
  });
}

function showMultiResult(results, answers){
  if(lastResultShown) return;
  lastResultShown = true;
  const wrongCount = results.filter(r => !r.correct).length;
  const allCorrect = wrongCount === 0;
  beep(allCorrect);

  const box = document.createElement("div");
  box.className = `result ${allCorrect ? "ok" : "ng"}`;
  box.innerHTML = `
    ${allCorrect ? "正解！" : "不正解です"}
    <div class="answer">${allCorrect ? "全問正解です。素晴らしいです！" : `${results.length}問中${wrongCount}問不正解です`}</div>
    <div class="answer">正解：${esc(Array.isArray(answers) ? answers.join("、") : answers)}</div>
    <button onclick="nextQuestion()">次へ</button>
  `;
  app.appendChild(box);
  box.scrollIntoView({behavior:"smooth", block:"center"});
}

function nextQuestion(){
  const unit = db.courses[courseIndex].units[unitIndex];
  questionIndex++;
  lastResultShown = false;

  if(questionIndex >= unit.questions.length){
    app.innerHTML = `
      <div class="card">
        <h1>終了</h1>
        <p>${esc(unit.title)} が終わりました。</p>
        <button onclick="startQuiz(${courseIndex},${unitIndex})">もう一度</button>
        <button class="secondary" onclick="renderUnits(${courseIndex})">単元へ</button>
      </div>
    `;
    return;
  }

  renderQuestion();
}

function renderAdmin(){
  db = ensureDbShape(db);
  if(db.courses.length === 0){
    db.courses.push({title:"新しい大分類", units:[{title:"新しい単元", questions:[]}]});
    courseIndex = 0;
    unitIndex = 0;
  }
  const c = db.courses[courseIndex] || db.courses[0];
  const u = c.units[unitIndex] || c.units[0];

  let html = `
    <div class="topbar">
      <div>
        <h1 class="page-title">管理画面</h1>
        <div class="sub">問題と答えの編集ができます。編集後は保存してください。</div>
      </div>
      <button class="secondary" onclick="renderUnits(${courseIndex})">戻る</button>
    </div>

    <div class="card">
      <div class="row">
        <button onclick="downloadJson()">JSON出力</button>
        <button class="secondary" onclick="importJson()">JSON読込</button>
        <button class="ok" onclick="addCoursePrompt()">大分類追加</button>
        <button class="ok" onclick="addUnitPrompt()">単元追加</button>
        <button class="secondary" onclick="renameCourse()">大分類名変更</button>
        <button class="ok" onclick="saveLocalData()">保存</button>
        <button class="danger" onclick="resetToInitialData()">初期データに戻す</button>
      </div>
      <div class="notice">保存ボタンでサーバーへ永続保存されます。別端末にも反映されます。</div>
    </div>

    <div class="grid-admin">
      <div class="card">
        <h3>単元</h3>
  `;

  c.units.forEach((unit, i)=>{
    html += `
      <div class="list-item ${i === unitIndex ? "active" : ""}">
        <strong>${esc(unit.title)}</strong><br>
        <span class="sub">${unit.questions.length}問</span><br>
        <button class="small" onclick="selectUnit(${i})">選択</button>
        <button class="small secondary" onclick="renameUnit(${i})">名称変更</button>
        <button class="small danger" onclick="deleteUnit(${i})">削除</button>
      </div>
    `;
  });

  html += `
      </div>
      <div class="card">
        <div class="topbar">
          <div>
            <h3>${esc(u.title)}</h3>
            <div class="sub">${u.questions.length}問</div>
          </div>
          <button onclick="openAddQuestion()">＋ 問題追加</button>
        </div>
  `;

  u.questions.forEach((q, i)=>{
    html += `
      <div class="q-item">
        <div class="q-head">
          <div>
            <span class="badge ${esc(q.type)}">${esc(labelType(q.type))}</span>
            <strong>${i + 1}. ${esc(q.question)}</strong>
            <div class="sub">正解：${esc(answerText(q))}</div>
          </div>
          <div class="row">
            <button class="small secondary" onclick="moveQuestion(${i},-1)">上</button>
            <button class="small secondary" onclick="moveQuestion(${i},1)">下</button>
            <button class="small" onclick="editQuestion(${i})">編集</button>
            <button class="small danger" onclick="deleteQuestion(${i})">削除</button>
          </div>
        </div>
      </div>
    `;
  });

  html += `</div></div>`;
  app.innerHTML = html;
}

function answerText(q){
  if(q.type === "fill" || q.type === "fill_multi" || q.type === "multi") return (q.answers || []).join("、");
  if(q.type === "image_fill") return (q.answers || []).join("、");
  return q.answer || "";
}

function selectUnit(i){
  unitIndex = i;
  renderAdmin();
}

function addCoursePrompt(){
  const title = prompt("大分類名");
  if(!normalize(title)) return;
  db.courses.push({title:normalize(title), units:[]});
  saveLocalData(false);
  courseIndex = db.courses.length - 1;
  unitIndex = 0;
  renderAdmin();
}

function addUnitPrompt(){
  const title = prompt("単元名");
  if(!normalize(title)) return;
  db.courses[courseIndex].units.push({title:normalize(title), questions:[]});
  saveLocalData(false);
  unitIndex = db.courses[courseIndex].units.length - 1;
  renderAdmin();
}


function renameCourse(){
  const c = db.courses[courseIndex];
  const title = prompt("大分類名", c.title);
  if(!normalize(title)) return;
  c.title = normalize(title);
  saveLocalData(false);
  renderAdmin();
}

function renameUnit(i){
  const u = db.courses[courseIndex].units[i];
  const title = prompt("単元名", u.title);
  if(!normalize(title)) return;
  u.title = normalize(title);
  saveLocalData(false);
  renderAdmin();
}

function deleteUnit(i){
  if(!confirm("この単元を削除しますか？")) return;
  db.courses[courseIndex].units.splice(i,1);
  saveLocalData(false);
  unitIndex = 0;
  renderAdmin();
}

function openAddQuestion(){
  editQuestion(null);
}

function editQuestion(index){
  const isNew = index === null;
  const unit = db.courses[courseIndex].units[unitIndex];
  const q = isNew ? {type:"fill", question:"", answers:[""]} : unit.questions[index];
  editingImageData = normalize(q.imageData || q.imageUrl || q.image || "");

  let html = `
    <div class="topbar">
      <div>
        <h1 class="page-title">${isNew ? "問題追加" : "問題編集"}</h1>
        <div class="sub">${esc(unit.title)}</div>
      </div>
      <button class="secondary" onclick="renderAdmin()">戻る</button>
    </div>

    <div class="card">
      <label>形式</label>
      <select id="editType" onchange="toggleAnswerInputMode()">
        <option value="fill" ${q.type==="fill"?"selected":""}>記述</option>
        <option value="fill_multi" ${q.type==="fill_multi"?"selected":""}>記述（複数空欄）</option>
        <option value="image_fill" ${q.type==="image_fill"?"selected":""}>画像穴埋め</option>
        <option value="ox" ${q.type==="ox"?"selected":""}>○×</option>
        <option value="choice" ${q.type==="choice"?"selected":""}>選択</option>
        <option value="multi" ${q.type==="multi"?"selected":""}>複数選択</option>
      </select>

      <label>問題文</label>
      <textarea id="editQuestion">${esc(q.question || "")}</textarea>

      <label>問題画像をアップロード</label>
      <div class="image-upload-wrap">
        <input id="editImageFile" class="hidden-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp">
        <div id="imageDropZone" class="drop-zone" onclick="triggerImageSelect()" ondragover="handleImageDragOver(event)" ondragleave="handleImageDragLeave(event)" ondrop="handleImageDrop(event)">
          <div class="drop-zone-title">問題画像をアップロード</div>
          <div class="drop-zone-sub">ここに画像をドロップ、またはファイルを選択</div>
        </div>
        <div id="editImagePreview" class="image-preview ${editingImageData ? "" : "hidden"}">
          <img id="editImagePreviewImg" src="${esc(editingImageData)}" alt="問題画像プレビュー">
          <button type="button" class="danger small" onclick="clearUploadedImage()">画像削除</button>
        </div>
      </div>

      <label>空欄数（fill_multi / image_fill のみ）</label>
      <input id="editBlankCount" type="number" min="1" value="${esc(getQuestionBlankCount(q) || "")}" placeholder="8" oninput="renderAnswerInputsByBlankCount()">

      <label>選択肢（選択・複数選択のみ。1行に1つ）</label>
      <textarea id="editChoices">${esc((q.choices || []).join("\\n"))}</textarea>
      <div class="row">
        <button type="button" class="secondary small" onclick="appendChoice()">選択肢追加</button>
        <button type="button" class="danger small" onclick="removeChoice()">選択肢削除</button>
      </div>

      <label id="editAnswersLabel">正解（1行に1つ。複数空欄は空欄順に入力。○×は ○ または ×）</label>
      <textarea id="editAnswers">${esc(q.type==="choice" || q.type==="ox" ? (q.answer || "") : (q.answers || []).join("\\n"))}</textarea>
      <div id="editAnswersList" class="hidden"></div>
      <div id="editAnswersTextActions" class="row">
        <button type="button" class="secondary small" onclick="appendAnswer()">正解追加</button>
        <button type="button" class="danger small" onclick="removeAnswer()">正解削除</button>
      </div>
      <div id="editAnswersMultiActions" class="row hidden">
        <button type="button" class="secondary small" onclick="appendFillMultiBlank()">fill_multi 空欄追加</button>
      </div>

      <button onclick="saveQuestion(${isNew ? "null" : index})">保存</button>
    </div>
  `;
  app.innerHTML = html;
  initImageUploader();
  toggleAnswerInputMode();
}

function triggerImageSelect(){
  document.getElementById("editImageFile")?.click();
}

function handleImageDragOver(event){
  event.preventDefault();
  document.getElementById("imageDropZone")?.classList.add("dragover");
}

function handleImageDragLeave(event){
  event.preventDefault();
  document.getElementById("imageDropZone")?.classList.remove("dragover");
}

function handleImageDrop(event){
  event.preventDefault();
  document.getElementById("imageDropZone")?.classList.remove("dragover");
  const file = event.dataTransfer?.files?.[0];
  if(file) loadQuestionImageFile(file);
}

function initImageUploader(){
  const input = document.getElementById("editImageFile");
  if(!input) return;
  input.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if(file) loadQuestionImageFile(file);
  });
}

function isAllowedImageType(file){
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return ["image/jpeg","image/png","image/webp"].includes(type) || /\.(jpg|jpeg|png|webp)$/.test(name);
}

function loadQuestionImageFile(file){
  if(!isAllowedImageType(file)) return alert("対応形式は jpg / jpeg / png / webp のみです");
  uploadImageToApi(file)
    .then((url) => {
      editingImageData = url;
      renderUploadedImagePreview();
    })
    .catch((e) => alert(e.message || "画像アップロードに失敗しました"));
}

function renderUploadedImagePreview(){
  const preview = document.getElementById("editImagePreview");
  const img = document.getElementById("editImagePreviewImg");
  if(!preview || !img) return;
  if(editingImageData){
    img.src = editingImageData;
    preview.classList.remove("hidden");
  }else{
    img.src = "";
    preview.classList.add("hidden");
  }
}

function clearUploadedImage(){
  editingImageData = "";
  const input = document.getElementById("editImageFile");
  if(input) input.value = "";
  renderUploadedImagePreview();
}


async function parseJsonSafe(response){
  try{
    return await response.json();
  }catch(e){
    return null;
  }
}

async function apiJson(url, options = {}, fallbackMessage = "APIエラー"){
  const response = await fetch(url, options);
  let data = await parseJsonSafe(response);
  if(!response.ok){
    if(!data){
      try{
        const bodyText = await response.text();
        data = bodyText ? { body: bodyText } : null;
      }catch(e){}
    }
    const detailParts = [];
    if(data?.error) detailParts.push(`error=${data.error}`);
    if(data?.message) detailParts.push(`message=${data.message}`);
    if(data?.body) detailParts.push(`body=${data.body}`);
    const detail = detailParts.length ? `: ${detailParts.join(" / ")}` : "";
    throw new Error(`${fallbackMessage} (status=${response.status})${detail}`);
  }
  return data;
}
async function uploadImageToApi(file){
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/upload`, { method:"POST", body:form });
  if(!res.ok){
    let message = "画像アップロードに失敗しました";
    try{
      const err = await res.json();
      if(err?.error) message += `: ${err.error}`;
    }catch(e){}
    throw new Error(message);
  }
  const json = await res.json();
  if(!json.imageUrl) throw new Error("画像URLの取得に失敗しました");
  return json.imageUrl || "";
}

async function syncAllQuestionsToApi(){
  const current = await apiJson(`${API_BASE}/api/questions`, {}, "問題一覧の取得に失敗しました");
  const currentIds = new Set();
  (current.courses || []).forEach(c => (c.units || []).forEach(u => (u.questions || []).forEach(q => currentIds.add(q.id))));
  const incomingIds = new Set();
  for(const course of db.courses){
    for(const unit of course.units){
      for(let i = 0; i < unit.questions.length; i++){
        const q = unit.questions[i];
        if(q.id) incomingIds.add(q.id);
        const payload = {...q, course:course.title, unit:unit.title, sortOrder:i};
        if(q.id){
          await apiJson(`${API_BASE}/api/questions/${encodeURIComponent(q.id)}`, {
            method:"PUT",
            headers:{"content-type":"application/json"},
            body:JSON.stringify(payload)
          }, "問題の更新に失敗しました");
        }else{
          const saved = await apiJson(`${API_BASE}/api/questions`, {
            method:"POST",
            headers:{"content-type":"application/json"},
            body:JSON.stringify(payload)
          }, "問題の作成に失敗しました");
          if(saved?.id) q.id = saved.id;
        }
      }
    }
  }
  for(const id of currentIds){
    if(!incomingIds.has(id)){
      await apiJson(`${API_BASE}/api/questions/${id}`, {method:"DELETE"}, "問題の削除に失敗しました");
    }
  }
  await loadData();
}


function appendLine(id, text = ""){
  const el = document.getElementById(id);
  if(!el) return;
  el.value = el.value ? `${el.value}\n${text}` : text;
  el.focus();
}

function removeLastLine(id){
  const el = document.getElementById(id);
  if(!el) return;
  const lines = el.value.split("\n");
  lines.pop();
  el.value = lines.join("\n");
  el.focus();
}

function appendChoice(){ appendLine("editChoices", ""); }
function removeChoice(){ removeLastLine("editChoices"); }
function appendAnswer(){ appendLine("editAnswers", ""); }
function removeAnswer(){ removeLastLine("editAnswers"); }

function renderAnswerInputsByBlankCount(){
  const typeEl = document.getElementById("editType");
  const list = document.getElementById("editAnswersList");
  const text = document.getElementById("editAnswers");
  if(!typeEl || !list || !text) return;
  const useList = typeEl.value === "fill_multi" || typeEl.value === "image_fill";

  const currentListAnswers = [...list.querySelectorAll("input[data-answer-index]")].map((input) => normalize(input.value));
  const textAnswers = text.value.split("\n").map(normalize).filter(Boolean);
  const savedAnswers = currentListAnswers.length ? currentListAnswers : textAnswers;

  list.innerHTML = "";
  const blankCount = Number(document.getElementById("editBlankCount")?.value) || 0;
  for(let i = 0; i < blankCount; i++){
    const v = savedAnswers[i] || "";
    list.innerHTML += `<label class="fill-multi-row">${esc(toCircledNumber(i + 1))}<input data-answer-index="${i}" value="${esc(v)}" placeholder="${esc(toCircledNumber(i + 1))}の正解"></label>`;
  }
  text.value = savedAnswers.join("\n");
}

function toggleAnswerInputMode(){
  const type = document.getElementById("editType")?.value;
  const list = document.getElementById("editAnswersList");
  const text = document.getElementById("editAnswers");
  const label = document.getElementById("editAnswersLabel");
  const textActions = document.getElementById("editAnswersTextActions");
  const multiActions = document.getElementById("editAnswersMultiActions");
  if(!list || !text || !label || !textActions || !multiActions) return;
  const isMultiBlank = type === "fill_multi" || type === "image_fill";
  if(isMultiBlank){
    label.textContent = "正解（空欄順に入力）";
    text.classList.add("hidden");
    list.classList.remove("hidden");
    textActions.classList.add("hidden");
    multiActions.classList.remove("hidden");
    renderAnswerInputsByBlankCount();
    return;
  }
  label.textContent = "正解（1行に1つ。複数空欄は空欄順に入力。○×は ○ または ×）";
  renderAnswerInputsByBlankCount();
  list.classList.add("hidden");
  text.classList.remove("hidden");
  textActions.classList.remove("hidden");
  multiActions.classList.add("hidden");
}

function appendFillMultiBlank(){
  const q = document.getElementById("editQuestion");
  if(q){
    q.value += "（　　　）";
    q.focus();
  }
  appendAnswer();
}

async function saveQuestion(index){
  const type = document.getElementById("editType").value;
  const question = normalize(document.getElementById("editQuestion").value);
  const choices = document.getElementById("editChoices").value.split("\n").map(normalize).filter(Boolean);
  let answers = document.getElementById("editAnswers").value.split("\n").map(normalize).filter(Boolean);

  const blankCount = Number(document.getElementById("editBlankCount").value) || 0;
  if(type === "fill_multi" || type === "image_fill"){
    answers = [...document.querySelectorAll("#editAnswersList input[data-answer-index]")].map(x => normalize(x.value));
    if(answers.some(a => !a)) return alert("正解入力欄をすべて入力してください");
    if(blankCount !== answers.length) return alert("空欄数と正解数が一致していません");
  }
  if(type !== "image_fill" && !question) return alert("問題文を入力してください");
  if(answers.length === 0) return alert("正解を入力してください");

  const existing = index === null ? null : db.courses[courseIndex].units[unitIndex].questions[index];
  let q = {type, question};
  if(existing?.id) q.id = existing.id;
  if(editingImageData) q.imageUrl = editingImageData;
  if(type === "fill" || type === "fill_multi"){
    if(type === "fill_multi") q.blankCount = blankCount;
    q.answers = answers;
  }else if(type === "image_fill"){
    q.blankCount = blankCount;
    q.answers = answers;
  }else if(type === "ox"){
    q.answer = answers[0];
  }else if(type === "choice"){
    q.choices = choices;
    q.answer = answers[0];
  }else if(type === "multi"){
    q.choices = choices;
    q.answers = answers;
  }

  const arr = db.courses[courseIndex].units[unitIndex].questions;
  if(index === null){
    arr.push(q);
  }else{
    arr[index] = q;
  }
  try{
    await saveLocalData(false);
    renderAdmin();
  }catch(e){
    alert(`保存に失敗しました: ${e?.message || e}`);
  }
}

async function deleteQuestion(i){
  if(!confirm("この問題を削除しますか？")) return;
  db.courses[courseIndex].units[unitIndex].questions.splice(i,1);
  try{
    await saveLocalData(false);
    renderAdmin();
  }catch(e){
    alert(`保存に失敗しました: ${e?.message || e}`);
  }
}

async function moveQuestion(i, dir){
  const arr = db.courses[courseIndex].units[unitIndex].questions;
  const ni = i + dir;
  if(ni < 0 || ni >= arr.length) return;
  [arr[i], arr[ni]] = [arr[ni], arr[i]];
  try{
    await saveLocalData(false);
    renderAdmin();
  }catch(e){
    alert(`保存に失敗しました: ${e?.message || e}`);
  }
}

function downloadJson(){
  const blob = new Blob([JSON.stringify(db,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "questions.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJson(){
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = e => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      db = JSON.parse(reader.result);
      saveLocalData(false);
      courseIndex = 0;
      unitIndex = 0;
      renderAdmin();
    };
    reader.readAsText(file);
  };
  input.click();
}

loadData();
