let db = null;
let view = "home";
let courseIndex = 0;
let unitIndex = 0;
let questionIndex = 0;
let lastResultShown = false;

const app = document.getElementById("app");

async function loadData(){
  const res = await fetch("questions.json?ts=" + Date.now());
  db = await res.json();
  renderUnits(0);
}

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function normalize(s){
  return String(s ?? "").trim();
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
    ox:"○×",
    choice:"選択",
    multi:"複数選択"
  }[t] || t;
}

function renderUnits(ci = 0){
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
      <div class="quiz-question">${esc(q.question)}</div>
  `;

  if(q.type === "fill"){
    html += `<input id="answerInput" autocomplete="off" placeholder="答えを入力してEnter"><button onclick="checkFill()">回答</button>`;
  }else if(q.type === "fill_multi"){
    q.answers.forEach((_, i)=>{
      html += `<input id="answerInput${i}" autocomplete="off" placeholder="答え ${i + 1}">`;
    });
    html += `<button onclick="checkFillMulti()">回答</button>`;
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
      }
    });
  }
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
  const val = normalize(document.getElementById("answerInput").value);
  const ok = val !== "" && q.answers.some(a => normalize(a) === val);
  showResult(ok, q.answers);
}

function checkFillMulti(){
  const q = currentQuestion();
  let ok = true;

  q.answers.forEach((ans, i)=>{
    const input = document.getElementById(`answerInput${i}`);
    const val = normalize(input ? input.value : "");
    if(val === "" || val !== normalize(ans)) ok = false;
  });

  showResult(ok, q.answers);
}

function checkSingle(v){
  const q = currentQuestion();
  showResult(normalize(q.answer) === normalize(v), q.answer);
}

function checkMulti(){
  const q = currentQuestion();
  const checked = [...document.querySelectorAll("input[type=checkbox]:checked")]
    .map(x=>normalize(x.value))
    .sort();
  const ans = q.answers.map(normalize).sort();
  showResult(JSON.stringify(checked) === JSON.stringify(ans), q.answers);
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
  const c = db.courses[courseIndex] || db.courses[0];
  const u = c.units[unitIndex] || c.units[0];

  let html = `
    <div class="topbar">
      <div>
        <h1 class="page-title">管理画面</h1>
        <div class="sub">問題と答えの編集ができます。編集後はJSON出力してください。</div>
      </div>
      <button class="secondary" onclick="renderUnits(${courseIndex})">戻る</button>
    </div>

    <div class="card">
      <div class="row">
        <button onclick="downloadJson()">JSON出力</button>
        <button class="secondary" onclick="importJson()">JSON読込</button>
        <button class="ok" onclick="addCoursePrompt()">大分類追加</button>
        <button class="ok" onclick="addUnitPrompt()">単元追加</button>
      </div>
      <div class="notice">GitHub Pagesではブラウザ内で直接サーバー保存できません。編集後にJSON出力し、questions.jsonをGitHubに上書きしてください。</div>
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
  courseIndex = db.courses.length - 1;
  unitIndex = 0;
  renderAdmin();
}

function addUnitPrompt(){
  const title = prompt("単元名");
  if(!normalize(title)) return;
  db.courses[courseIndex].units.push({title:normalize(title), questions:[]});
  unitIndex = db.courses[courseIndex].units.length - 1;
  renderAdmin();
}

function renameUnit(i){
  const u = db.courses[courseIndex].units[i];
  const title = prompt("単元名", u.title);
  if(!normalize(title)) return;
  u.title = normalize(title);
  renderAdmin();
}

function deleteUnit(i){
  if(!confirm("この単元を削除しますか？")) return;
  db.courses[courseIndex].units.splice(i,1);
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
      <select id="editType">
        <option value="fill" ${q.type==="fill"?"selected":""}>記述</option>
        <option value="fill_multi" ${q.type==="fill_multi"?"selected":""}>記述（複数空欄）</option>
        <option value="ox" ${q.type==="ox"?"selected":""}>○×</option>
        <option value="choice" ${q.type==="choice"?"selected":""}>選択</option>
        <option value="multi" ${q.type==="multi"?"selected":""}>複数選択</option>
      </select>

      <label>問題文</label>
      <textarea id="editQuestion">${esc(q.question || "")}</textarea>

      <label>選択肢（選択・複数選択のみ。1行に1つ）</label>
      <textarea id="editChoices">${esc((q.choices || []).join("\\n"))}</textarea>

      <label>正解（1行に1つ。複数空欄は空欄順に入力。○×は ○ または ×）</label>
      <textarea id="editAnswers">${esc(q.type==="choice" || q.type==="ox" ? (q.answer || "") : (q.answers || []).join("\\n"))}</textarea>

      <button onclick="saveQuestion(${isNew ? "null" : index})">保存</button>
    </div>
  `;
  app.innerHTML = html;
}

function saveQuestion(index){
  const type = document.getElementById("editType").value;
  const question = normalize(document.getElementById("editQuestion").value);
  const choices = document.getElementById("editChoices").value.split("\n").map(normalize).filter(Boolean);
  const answers = document.getElementById("editAnswers").value.split("\n").map(normalize).filter(Boolean);

  if(!question) return alert("問題文を入力してください");
  if(answers.length === 0) return alert("正解を入力してください");

  let q = {type, question};
  if(type === "fill" || type === "fill_multi"){
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
  renderAdmin();
}

function deleteQuestion(i){
  if(!confirm("この問題を削除しますか？")) return;
  db.courses[courseIndex].units[unitIndex].questions.splice(i,1);
  renderAdmin();
}

function moveQuestion(i, dir){
  const arr = db.courses[courseIndex].units[unitIndex].questions;
  const ni = i + dir;
  if(ni < 0 || ni >= arr.length) return;
  [arr[i], arr[ni]] = [arr[ni], arr[i]];
  renderAdmin();
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
      courseIndex = 0;
      unitIndex = 0;
      renderAdmin();
    };
    reader.readAsText(file);
  };
  input.click();
}

loadData();
