const API_BASE = window.KAIGO_QUIZ_API_BASE || "https://kaigo-quiz-save.info-chibafukushi.workers.dev";
let db = { appTitle: "カイゴクイズ", courses: [] };
let courseIndex = 0, unitIndex = 0, questionIndex = 0;
let saving = false, deleting = false;
let editingQuestionId = null;
const app = document.getElementById("app");

const TYPES = ["choice","ox","multi","fill","fill_multi","image_fill"];
const TLABEL = {choice:"4択",ox:"○×",multi:"複数選択",fill:"記述",fill_multi:"空欄補充",image_fill:"画像穴埋め"};

const esc=(v)=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const norm=(v)=>String(v??"").trim();
const isMB=(t)=>t==="fill_multi"||t==="image_fill";
const nQ=(q={})=>({type:q.type||"fill",question:q.question||"",explanation:q.explanation||"",choices:Array.isArray(q.choices)?q.choices:[],answer:q.answer??"",answers:Array.isArray(q.answers)?q.answers:[],blankCount:Number(q.blankCount)>0?Number(q.blankCount):(Array.isArray(q.answers)&&q.answers.length)||1,imageData:q.imageData||q.image||q.imageUrl||"",id:q.id,courseId:q.courseId,unitId:q.unitId});
const eDB=(d)=>({appTitle:d?.appTitle||"カイゴクイズ",courses:Array.isArray(d?.courses)?d.courses.map(c=>{const units=Array.isArray(c?.units)?c.units.map(u=>{const questions=Array.isArray(u?.questions)?u.questions.map(nQ):[];const unitId=u?.unitId??u?.id??questions.find(q=>q?.unitId!=null)?.unitId;return {id:u?.id,unitId,title:u?.title||"",isVisible:u?.isVisible!==false,questions};}):[];const courseId=c?.courseId??c?.id??units.flatMap(u=>u.questions||[]).find(q=>q?.courseId!=null)?.courseId;return {id:c?.id,courseId,title:c?.title||"",units};}):[]});
const gAns=(q)=>{const n=Math.max(1,Number(q.blankCount)||1),a=Array.isArray(q.answers)?q.answers.slice():[];while(a.length<n)a.push("");return a.slice(0,n)};

async function api(path, init={}){const r=await fetch(`${API_BASE}${path}`,init);if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);const ct=r.headers.get("content-type")||"";return ct.includes("application/json")?r.json():r.text();}
async function loadData(admin=false){db=eDB(await api(`/api/questions${admin?"?admin=1":""}`));}

function curUnit(){return db.courses[courseIndex]?.units?.[unitIndex];}
function curQ(){return curUnit()?.questions?.[questionIndex];}

function renderHome(){let h=`<div class="topbar"><button class="secondary" data-act="open-admin">⚙ 管理</button></div><div class="card"><h1>${esc(db.appTitle)}</h1><p>科目を選択</p></div>`;db.courses.forEach((c,ci)=>h+=`<div class="card unit-card" data-act="open-course" data-ci="${ci}"><div>📚 ${esc(c.title)}</div><div>›</div></div>`);app.innerHTML=h;}
function renderUnits(ci){courseIndex=ci;const c=db.courses[ci];let h=`<div class="topbar"><button class="secondary" data-act="home">戻る</button><button class="secondary" data-act="open-admin">⚙ 管理</button></div><div class="card"><h2>${esc(c.title)}</h2></div>`;(c.units||[]).forEach((u,ui)=>{if(u.isVisible===false)return;h+=`<div class="card unit-card" data-act="start-quiz" data-ci="${ci}" data-ui="${ui}"><div>${esc(u.title)}</div><div class="sub">${u.questions.length}問 ›</div></div>`});app.innerHTML=h;}
function renderQuestion(){const u=curUnit(),q=curQ();let h=`<div class="topbar"><button class="secondary" data-act="back-units">単元へ</button></div><div class="card"><h3>${esc(u.title)} ${questionIndex+1}/${u.questions.length}</h3>`;if(q.imageData)h+=`<img class="quiz-image" src="${esc(q.imageData)}">`;h+=`<p>${esc(q.question)}</p>`;if(q.type==="ox")h+=`<button data-act="ans-single" data-v="○">○</button><button data-act="ans-single" data-v="×">×</button>`;else if(q.type==="choice")q.choices.forEach(c=>h+=`<button data-act="ans-single" data-v="${esc(c)}">${esc(c)}</button>`);else if(q.type==="multi"){q.choices.forEach(c=>h+=`<label><input type="checkbox" class="multi-answer" value="${esc(c)}">${esc(c)}</label>`);h+=`<button data-act="ans-multi">回答</button>`;} else if(q.type==="fill")h+=`<input id="answerInput"><button data-act="ans-fill">回答</button>`;else {for(let i=0;i<Math.max(1,Number(q.blankCount)||1);i++)h+=`<input class="blank-input" placeholder="アンサー${i+1}">`;h+=`<button data-act="ans-fill-multi">回答</button>`;}h+=`<div id="result"></div></div>`;app.innerHTML=h;}
function judge(ok,exp){document.getElementById("result").innerHTML=`<p class="${ok?"result-ok":"result-ng"}">${ok?"✅正解":"❌不正解"}</p><p>正解: ${esc(exp)}</p><button data-act="next-q">次へ</button>`;}

function renderAdmin(){const c=db.courses[courseIndex]||db.courses[0];courseIndex=Math.max(0,db.courses.indexOf(c));const u=c?.units?.[unitIndex]||c?.units?.[0];unitIndex=Math.max(0,c?.units?.indexOf(u));let h=`<div class="topbar"><button class="secondary" data-act="home">TOP</button><button data-act="save-all">保存</button></div>`;
h+=`<div class="card"><h3>管理画面</h3><label>科目<select id="adminCourse">`;db.courses.forEach((x,i)=>h+=`<option value="${i}" ${i===courseIndex?"selected":""}>${esc(x.title)}</option>`);h+=`</select></label><div><button data-act="add-course">科目追加</button><button data-act="ren-course">科目名変更</button><button data-act="del-course">科目削除</button></div>`;
h+=`<label>単元<select id="adminUnit">`;(db.courses[courseIndex]?.units||[]).forEach((x,i)=>h+=`<option value="${i}" ${i===unitIndex?"selected":""}>${esc(x.title)} ${x.isVisible===false?"(非表示)":""}</option>`);h+=`</select></label><div><button data-act="add-unit">単元追加</button><button data-act="ren-unit">単元名変更</button><button data-act="toggle-unit">表示/非表示</button><button data-act="del-unit">単元削除</button></div>`;
h+=`<div><button data-act="add-q">問題追加</button><button data-act="export-json">JSON出力</button><input type="file" id="importJson" accept="application/json"></div></div>`;
h+=`<div class="card"><h4>問題一覧</h4>`;(curUnit()?.questions||[]).forEach((q,i)=>h+=`<div class="card"><div>${i+1}. [${esc(TLABEL[q.type]||q.type)}] ${esc((q.question||"").slice(0,60))}</div><button data-act="up-q" data-qi="${i}">↑</button><button data-act="down-q" data-qi="${i}">↓</button><button data-act="edit-q" data-qi="${i}">編集</button><button data-act="del-q" data-qi="${i}">削除</button></div>`);h+=`</div>`;app.innerHTML=h;}

function typeFields(q){let h=`<label>問題文<input id="eq-question" value="${esc(q.question||"")}"></label><label>解説<textarea id="eq-exp">${esc(q.explanation||"")}</textarea></label><label>画像<input type="file" id="eq-image-file" accept="image/*"></label><div id="img-preview">${q.imageData?`<img class="quiz-image" src="${esc(q.imageData)}">`:""}</div><button class="secondary" data-act="img-clear">画像削除</button>`;
if(q.type==="ox")h+=`<label>正解<select id="eq-answer"><option value="○" ${q.answer==="○"?"selected":""}>○</option><option value="×" ${q.answer==="×"?"selected":""}>×</option></select></label>`;
if(q.type==="choice"||q.type==="multi")h+=`<label>選択肢(改行区切り)<textarea id="eq-choices">${esc((q.choices||[]).join("\n"))}</textarea></label>`;
if(q.type==="choice"||q.type==="fill")h+=`<label>正解<input id="eq-answer" value="${esc(q.answer||"")}"></label>`;
if(q.type==="multi")h+=`<label>正解(改行区切り)<textarea id="eq-answers-text">${esc((q.answers||[]).join("\n"))}</textarea></label>`;
if(isMB(q.type)){h+=`<label>blankCount<input id="eq-blankCount" type="number" min="1" max="8" value="${Math.max(1,Number(q.blankCount)||1)}"></label><div id="eq-answers">`;gAns(q).forEach((a,i)=>h+=`<label>アンサー${i+1}<input class="edit-answer" value="${esc(a||"")}"></label>`);h+=`</div>`;}
return h;}
function renderQuestionTypeSelector(){app.innerHTML=`<div class="topbar"><button data-act="admin-back">戻る</button></div><div class="card"><h3>問題タイプを選択</h3>${TYPES.map(t=>`<button data-act="pick-type" data-type="${t}">${esc(TLABEL[t])}</button>`).join("")}</div><div class="card" id="live-editor"><p class="sub">タイプ選択で入力UIを表示します</p></div>`;}
function renderEditQuestion(qi){const q=curUnit().questions[qi];editingQuestionId=q?.id??null;app.innerHTML=`<div class="topbar"><button data-act="admin-back">戻る</button></div><div class="card"><h3>${esc(db.courses[courseIndex].title)} / ${esc(curUnit().title)} / ${esc(TLABEL[q.type])}</h3>${typeFields(q)}<button data-act="save-q" data-qi="${qi}">保存</button></div>`;}
function renderCreateForType(type){editingQuestionId=null;const q=nQ({type,blankCount:1});app.innerHTML=`<div class="topbar"><button data-act="admin-back">戻る</button></div><div class="card"><h3>新規問題: ${esc(TLABEL[type])}</h3>${typeFields(q)}<button data-act="create-q" data-type="${type}">保存</button></div>`;}


function isPreviewImageSrc(v){const s=String(v||"").trim().toLowerCase();return s.startsWith("blob:")||s.startsWith("data:")||s.startsWith("object:");}
function syncPreviewToQuestion(q){
  const img=document.querySelector('#img-preview img');
  const src=img?String(img.getAttribute('src')||'').trim():"";
  if(!src){q.imageData="";return;}
  if(isPreviewImageSrc(src))return;
  q.imageData=src;
}
function applyEditorToQuestion(q){q.question=norm(document.getElementById("eq-question")?.value);q.explanation=norm(document.getElementById("eq-exp")?.value);q.imageData=q.imageData||"";syncPreviewToQuestion(q);if(q.type==="ox"||q.type==="choice"||q.type==="fill")q.answer=norm(document.getElementById("eq-answer")?.value);if(q.type==="choice"||q.type==="multi")q.choices=(document.getElementById("eq-choices")?.value||"").split("\n").map(norm).filter(Boolean);if(q.type==="multi")q.answers=(document.getElementById("eq-answers-text")?.value||"").split("\n").map(norm).filter(Boolean);if(isMB(q.type)){q.blankCount=Math.max(1,Number(document.getElementById("eq-blankCount")?.value)||1);q.answers=[...document.querySelectorAll(".edit-answer")].map(x=>norm(x.value)).slice(0,q.blankCount);while(q.answers.length<q.blankCount)q.answers.push("");if(q.answers.length!==q.blankCount)throw new Error("blankCount mismatch");}}
function buildQuestionPayload(q,ctx={}){
  const imageUrl=isPreviewImageSrc(q.imageData)?"":String(q.imageData||"").trim();
  const payload={
    id:q.id,
    type:norm(q.type||"fill"),
    question:norm(q.question),
    choices:Array.isArray(q.choices)?q.choices.map(norm).filter(Boolean):[],
    answers:Array.isArray(q.answers)?q.answers.map(norm):[],
    answer:norm(q.answer),
    explanation:norm(q.explanation),
    imageUrl,
    imageData:imageUrl,
    blankCount:Math.max(1,Number(q.blankCount)||1)
  };
  const courseId=q.courseId??ctx.courseId;
  const unitId=q.unitId??ctx.unitId;
  if(courseId!==undefined&&courseId!==null&&courseId!=="")payload.courseId=courseId;
  if(unitId!==undefined&&unitId!==null&&unitId!=="")payload.unitId=unitId;
  Object.keys(payload).forEach((k)=>{if(payload[k]===undefined||payload[k]===null)delete payload[k];});
  return payload;
}

async function saveQuestion(qi){if(saving)return;const list=curUnit().questions||[];const q=(editingQuestionId!=null?list.find(x=>String(x?.id)===String(editingQuestionId)):null)||list[qi];if(!q){alert("保存対象の問題が見つかりません。");return;}const fixedType=q.type;const fixedBlankCount=q.blankCount;const fixedAnswers=Array.isArray(q.answers)?q.answers.slice():[];try{applyEditorToQuestion(q);}catch{alert("blankCount と answers 数が一致しないため保存できません。");return;}if(editingQuestionId!=null&&q.type!==fixedType){q.type=fixedType;if(isMB(fixedType)){q.blankCount=fixedBlankCount;q.answers=fixedAnswers;}}saving=true;try{const course=db.courses[courseIndex]||{};const unit=course.units?.[unitIndex]||{};console.log("COURSE",course);console.log("UNIT",unit);const resolvedCourseId=course.courseId;const resolvedUnitId=unit.unitId;if(!q.id){q.courseId=resolvedCourseId;q.unitId=resolvedUnitId;}const payload=buildQuestionPayload(q,{courseId:resolvedCourseId,unitId:resolvedUnitId});if(!q.id&&(payload.courseId===undefined||payload.courseId===null||payload.unitId===undefined||payload.unitId===null)){throw new Error("新規問題の保存先(courseId/unitId)が不正です。");}console.log("SAVE PAYLOAD",payload);console.log(JSON.stringify(payload,null,2));const path=q.id?`/api/questions/${q.id}`:`/api/questions`;const method=q.id?"PUT":"POST";const res=await fetch(`${API_BASE}${path}`,{method,headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const text=await res.text();if(!res.ok){console.error(text);throw new Error(`${res.status} ${res.statusText}`);}if(text){try{JSON.parse(text);}catch(_){}}await loadData(true);renderAdmin();}catch(e){alert(`保存エラー: ${e.message}`);}finally{saving=false;}}
async function createQuestion(type){const q=nQ({type});try{applyEditorToQuestion(q);}catch{alert("blankCount と answers 数が一致しないため保存できません。");return;}curUnit().questions.push(q);await saveQuestion(curUnit().questions.length-1);}
async function deleteQuestion(qi){if(deleting)return;const q=curUnit().questions[qi];if(!confirm("削除しますか？"))return;deleting=true;try{if(q.id)await api(`/api/questions/${q.id}`,{method:"DELETE"});else curUnit().questions.splice(qi,1);await loadData(true);renderAdmin();}catch(e){alert(`削除エラー: ${e.message}`);}finally{deleting=false;}}

document.addEventListener("click",async(e)=>{const t=e.target.closest("[data-act]");if(!t)return;const a=t.dataset.act;
if(a==="home"){if(db.courses.length)renderUnits(courseIndex||0);} else if(a==="open-admin"){await loadData(true);renderAdmin();} else if(a==="open-course")renderUnits(+t.dataset.ci); else if(a==="start-quiz"){courseIndex=+t.dataset.ci;unitIndex=+t.dataset.ui;questionIndex=0;renderQuestion();} else if(a==="back-units")renderUnits(courseIndex); else if(a==="next-q"){questionIndex++;questionIndex>=curUnit().questions.length?renderUnits(courseIndex):renderQuestion();}
else if(a==="ans-single"){const q=curQ();judge(norm(t.dataset.v)===norm(q.answer),q.answer);} else if(a==="ans-fill"){const q=curQ();judge(norm(document.getElementById("answerInput").value)===norm(q.answer),q.answer);} else if(a==="ans-multi"){const q=curQ(),got=[...document.querySelectorAll('.multi-answer:checked')].map(x=>norm(x.value)).sort().join('|'),exp=(q.answers||[]).map(norm).sort().join('|');judge(got===exp,(q.answers||[]).join(','));} else if(a==="ans-fill-multi"){const q=curQ(),got=[...document.querySelectorAll('.blank-input')].map(x=>norm(x.value)),exp=gAns(q);judge(got.length===Number(q.blankCount)&&got.every((x,i)=>x===norm(exp[i])),exp.join(', '));}
else if(a==="admin-back")renderAdmin(); else if(a==="add-q")renderQuestionTypeSelector(); else if(a==="pick-type")renderCreateForType(t.dataset.type); else if(a==="create-q")await createQuestion(t.dataset.type); else if(a==="edit-q")renderEditQuestion(+t.dataset.qi); else if(a==="save-q")await saveQuestion(+t.dataset.qi); else if(a==="del-q")await deleteQuestion(+t.dataset.qi);
else if(a==="up-q"){const i=+t.dataset.qi,arr=curUnit().questions;if(i>0)[arr[i-1],arr[i]]=[arr[i],arr[i-1]];renderAdmin();} else if(a==="down-q"){const i=+t.dataset.qi,arr=curUnit().questions;if(i<arr.length-1)[arr[i+1],arr[i]]=[arr[i],arr[i+1]];renderAdmin();}
else if(a==="add-course"){const n=prompt("科目名");if(n)db.courses.push({title:n,units:[]});renderAdmin();} else if(a==="ren-course"){const n=prompt("科目名",db.courses[courseIndex]?.title||"");if(n!=null)db.courses[courseIndex].title=n;renderAdmin();} else if(a==="del-course"){if(confirm("科目を削除しますか？")){db.courses.splice(courseIndex,1);courseIndex=0;unitIndex=0;renderAdmin();}}
else if(a==="add-unit"){const n=prompt("単元名");if(n)db.courses[courseIndex].units.push({title:n,isVisible:true,questions:[]});renderAdmin();} else if(a==="ren-unit"){const u=curUnit();if(!u)return;const n=prompt("単元名",u.title);if(n!=null)u.title=n;renderAdmin();} else if(a==="toggle-unit"){const u=curUnit();if(u){u.isVisible=u.isVisible===false?true:false;try{await api(`/api/units/${u.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({isVisible:u.isVisible})});}catch(_){ }renderAdmin();}} else if(a==="del-unit"){if(confirm("単元削除しますか？")){db.courses[courseIndex].units.splice(unitIndex,1);unitIndex=0;renderAdmin();}}
else if(a==="save-all")alert("各問題の保存で反映されます。保存対象の問題を編集画面から保存してください。"); else if(a==="export-json"){const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"});const ael=document.createElement('a');ael.href=URL.createObjectURL(blob);ael.download='questions.json';ael.click();URL.revokeObjectURL(ael.href);} else if(a==="img-clear"){const p=document.getElementById('img-preview');if(p)p.innerHTML='';}
});

document.addEventListener("change",async(e)=>{const id=e.target.id;
if(id==="adminCourse"){courseIndex=+e.target.value;unitIndex=0;renderAdmin();}
else if(id==="adminUnit"){unitIndex=+e.target.value;renderAdmin();}
else if(id==="importJson"){const f=e.target.files?.[0];if(!f)return;db=eDB(JSON.parse(await f.text()));renderAdmin();}
else if(id==="eq-blankCount"){const cnt=Math.max(1,Number(e.target.value)||1),box=document.getElementById('eq-answers');if(!box)return;const prev=[...box.querySelectorAll('.edit-answer')].map(x=>x.value);let h='';for(let i=0;i<cnt;i++)h+=`<label>アンサー${i+1}<input class="edit-answer" value="${esc(prev[i]||'')}"></label>`;box.innerHTML=h;}
else if(id==="eq-image-file"){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{const p=document.getElementById('img-preview');if(p)p.innerHTML=`<img class="quiz-image" src="${esc(r.result)}">`;};r.readAsDataURL(f);}
});

(async()=>{try{await loadData(false);}catch(e){console.error(e);}if(db.courses.length){courseIndex=0;renderUnits(0);}else{app.innerHTML='<div class="card"><h2>データがありません</h2></div>';}})();
