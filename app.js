import fs from 'node:fs/promises';

const apiBase = process.argv[2] || '';
const jsonPath = process.argv[3] || 'questions.json';

const src = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
const jsonCount = countQuestions(src);

let apiCount = null;
if (apiBase) {
  const res = await fetch(`${apiBase.replace(/\/$/, '')}/api/questions`);
  if (!res.ok) throw new Error(`API request failed: ${res.status}`);
  const data = await res.json();
  apiCount = countQuestions(data);
}

const sql = await fs.readFile('d1-seed.sql', 'utf8');
const insertCount = (sql.match(/INSERT INTO questions/g) || []).length;

console.log(JSON.stringify({ jsonCount, seedInsertCount: insertCount, apiCount }, null, 2));

function countQuestions(data) {
  let n = 0;
  for (const c of data.courses || []) for (const u of c.units || []) n += (u.questions || []).length;
  return n;
}
