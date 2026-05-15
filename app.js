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
  renderHome();
}

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
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

function header(title, backFn="renderHome"){
  return `<div class="header"><div><div class="title">${esc(title)}</div><div class="sub">${esc(db.appTitle || "カイゴクイズ")}</div></div><button class="secondary" onclick="${backFn}()">戻る</button></div>`;
}

function renderHome(){
  view = "home";
  let html = `<div class="header"><div><h1>${esc(db.appTitle || "カイゴクイズ")}</h1><div class="sub">大分類を選択してください</div></div><button onclick="renderAdmin()">管理</button></div>`;
  db.courses.forEach((c, i)=>{
    const count = c.units.reduce((a,u)=>a+(u.questions?.length||0),0);
    html += `<div class="card list-card" onclick="renderUnits(${i})"><div class="title">${esc(c.title)}</div><div class="sub">${c.units.length}単元 / ${count}問</div></div>`;
  });
  html += `<div class="card"><div class="small">GitHub Pages用：管理画面で編集後、JSON出力 → questions.json としてGitHubに上書きしてください。</div></div>`;
  app.innerHTML = html;
}

function renderUnits(ci){
  courseIndex = ci;
  const c = db.courses[ci];
  let html = header(c.title, "renderHome");
  html += `<div class="sub">単元を選択してください</div>`;
  c.units.forEach((u, i)=>{
    html += `<div class="card list-card" onclick="startQuiz(${ci},${i})"><div class="title">${esc(u.title)}</div><div class="sub">${u.questions.length}問</div></div>`;
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

function renderQuestion(){
  const unit = db.courses[courseIndex].units[unitIndex];
  const q = unit.questions[questionIndex];
  const percent = Math.round((questionIndex / unit.questions.length) * 100);
  let html = `<div class="header"><div><div class="title">${esc(unit.title)}</div><div class="sub">${questionIndex+1} / ${unit.questions.length}</div></div><button class="secondary" onclick="renderUnits(${courseIndex})">単元へ</button></div>`;
  html += `<div class="progress"><div class="bar" style="width:${percent}%"></div></div>`;
  html += `<div class="card"><span class="badge">${labelType(q.type)}</span><h2>${esc(q.question)}</h2>`;
  if(q.type === "fill"){
    html += `<input id="answerInput" autocomplete="off" placeholder="答えを入力してEnter"><button onclick="checkFill()">回答</button>`;
  }else if(q.type === "ox"){
    html += `<div class="row"><button onclick="checkSingle('○')">○</button><button onclick="checkSingle('×')">×</button></div>`;
  }else if(q.type === "choice"){
    q.choices.forEach(ch=>{
      html += `<button class="choice" onclick='checkSingle(${JSON.stringify(ch)})'>${esc(ch)}</button>`;
    });
  }else if(q.type === "multi"){
    q.choices.forEach(ch=>{
      html += `<label class="check"><input type="checkbox" value="${esc(ch)}">${esc(ch)}</label>`;
    });
    html += `<button onclick="checkMulti()">回答</button>`;
  }
  html += `</div>`;
  app.innerHTML = html;
  const input = document.getElementById("answerInput");
  if(input){
    input.focus();
    input.addEventListener("keydown", e => { if(e.key === "Enter") checkFill(); });
  }
}

function labelType(t){
  return {fill:"記述", ox:"○×", choice:"選択", multi:"複数選択"}[t] || t;
}

function normalize(s){
  return String(s ?? "").trim();
}

function showResult(ok, ans){
  if(lastResultShown) return;
  lastResultShown = true;
  beep(ok);
  const box = document.createElement("div");
  box.className = `result ${ok ? "ok" : "ng"}`;
  box.innerHTML = `${ok ? "○ 正解" : "× 不正解"}<div class="answer">正解：${esc(Array.isArray(ans) ? ans.join("、") : ans)}</div><button onclick="nextQuestion()">次へ</button>`;
  app.appendChild(box);
  box.scrollIntoView({behavior:"smooth", block:"center"});
}

function currentQuestion(){
  return db.courses[courseIndex].units[unitIndex].questions[questionIndex];
}

function checkFill(){
  const q = currentQuestion();
  const val = normalize(document.getElementById("answerInput").value);
  const ok = val !== "" && q.answers.some(a => normalize(a) === val);
  showResult(ok, q.answers[0]);
}

function checkSingle(v){
  const q = currentQuestion();
  showResult(normalize(q.answer) === normalize(v), q.answer);
}

function checkMulti(){
  const q = currentQuestion();
  const checked = [...document.querySelectorAll("input[type=checkbox]:checked")].map(x=>normalize(x.value)).sort();
  const ans = q.answers.map(normalize).sort();
  showResult(JSON.stringify(checked) === JSON.stringify(ans), q.answers);
}

function nextQuestion(){
  const unit = db.courses[courseIndex].units[unitIndex];
  questionIndex++;
  lastResultShown = false;
  if(questionIndex >= unit.questions.length){
    app.innerHTML = `<div class="card"><h1>終了</h1><p>${esc(unit.title)} が終わりました。</p><button onclick="startQuiz(${courseIndex},${unitIndex})">もう一度</button><button class="secondary" onclick="renderUnits(${courseIndex})">単元へ</button></div>`;
    return;
  }
  renderQuestion();
}

function renderAdmin(){
  let html = `<div class="header"><div><div class="title">管理</div><div class="sub">編集後はJSON出力してください</div></div><button class="secondary" onclick="renderHome()">戻る</button></div>`;
  html += `<div class="card"><button onclick="downloadJson()">JSON出力</button><button onclick="importJson()">JSON読込</button></div>`;
  html += `<div class="card"><h3>大分類追加</h3><input id="newCourse" placeholder="例：介護福祉士実務者研修"><button onclick="addCourse()">追加</button></div>`;
  db.courses.forEach((c, ci)=>{
    html += `<div class="card"><h3>${esc(c.title)}</h3><button onclick="editCourse(${ci})">単元管理</button><button class="danger" onclick="deleteCourse(${ci})">削除</button></div>`;
  });
  app.innerHTML = html;
}

function addCourse(){
  const v = normalize(document.getElementById("newCourse").value);
  if(!v) return;
  db.courses.push({title:v, units:[]});
  renderAdmin();
}

function deleteCourse(ci){
  if(confirm("削除しますか？")){
    db.courses.splice(ci,1);
    renderAdmin();
  }
}

function editCourse(ci){
  courseIndex = ci;
  const c = db.courses[ci];
  let html = header("単元管理：" + c.title, "renderAdmin");
  html += `<div class="card"><h3>単元追加</h3><input id="newUnit" placeholder="例：人間の尊厳と自立"><button onclick="addUnit()">追加</button></div>`;
  c.units.forEach((u, ui)=>{
    html += `<div class="card"><h3>${esc(u.title)}</h3><div class="sub">${u.questions.length}問</div><button onclick="editUnit(${ui})">問題管理</button><button class="danger" onclick="deleteUnit(${ui})">削除</button></div>`;
  });
  app.innerHTML = html;
}

function addUnit(){
  const v = normalize(document.getElementById("newUnit").value);
  if(!v) return;
  db.courses[courseIndex].units.push({title:v, questions:[]});
  editCourse(courseIndex);
}

function deleteUnit(ui){
  if(confirm("削除しますか？")){
    db.courses[courseIndex].units.splice(ui,1);
    editCourse(courseIndex);
  }
}

function editUnit(ui){
  unitIndex = ui;
  const u = db.courses[courseIndex].units[ui];
  let html = header("問題管理：" + u.title, `editCourse.bind(null,${courseIndex})`);
  html += `<div class="card">
    <h3>問題追加</h3>
    <select id="qType">
      <option value="fill">記述</option>
      <option value="ox">○×</option>
      <option value="choice">選択式</option>
      <option value="multi">複数選択</option>
    </select>
    <textarea id="qText" placeholder="問題文"></textarea>
    <textarea id="qChoices" placeholder="選択肢：1行に1つ。記述/○×では空欄でOK"></textarea>
    <textarea id="qAnswers" placeholder="正解：1行に1つ。○×は ○ または ×"></textarea>
    <button onclick="addQuestion()">追加</button>
  </div>`;
  u.questions.forEach((q, qi)=>{
    html += `<div class="card"><div class="badge">${labelType(q.type)}</div><h3>${qi+1}. ${esc(q.question)}</h3><button onclick="moveQuestion(${qi},-1)">上へ</button><button onclick="moveQuestion(${qi},1)">下へ</button><button class="danger" onclick="deleteQuestion(${qi})">削除</button></div>`;
  });
  app.innerHTML = html;
}

function addQuestion(){
  const type = document.getElementById("qType").value;
  const question = normalize(document.getElementById("qText").value);
  const choices = document.getElementById("qChoices").value.split("\n").map(normalize).filter(Boolean);
  const answers = document.getElementById("qAnswers").value.split("\n").map(normalize).filter(Boolean);
  if(!question || answers.length === 0) return alert("問題文と正解を入力してください");
  let q = {type, question};
  if(type === "fill") q.answers = answers;
  if(type === "ox") q.answer = answers[0];
  if(type === "choice"){ q.choices = choices; q.answer = answers[0]; }
  if(type === "multi"){ q.choices = choices; q.answers = answers; }
  db.courses[courseIndex].units[unitIndex].questions.push(q);
  editUnit(unitIndex);
}

function deleteQuestion(qi){
  if(confirm("削除しますか？")){
    db.courses[courseIndex].units[unitIndex].questions.splice(qi,1);
    editUnit(unitIndex);
  }
}

function moveQuestion(qi, dir){
  const arr = db.courses[courseIndex].units[unitIndex].questions;
  const ni = qi + dir;
  if(ni < 0 || ni >= arr.length) return;
  [arr[qi], arr[ni]] = [arr[ni], arr[qi]];
  editUnit(unitIndex);
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
      renderAdmin();
    };
    reader.readAsText(file);
  };
  input.click();
}

loadData();
