import fs from "node:fs/promises";

const file = process.argv[2] || "questions.json";
const data = JSON.parse(await fs.readFile(file, "utf8"));

let sql = [];
sql.push("DELETE FROM questions;");

for (const course of data.courses || []) {
  for (const unit of course.units || []) {
    (unit.questions || []).forEach((q, index) => {
      const answers = (q.type === "ox" || q.type === "choice") ? [q.answer || ""] : (q.answers || []);
      const choices = q.choices || [];
      const blankCount = Number(q.blankCount || q.blanks || 0);
      const imageUrl = q.imageUrl || q.image || q.imageData || "";
      const explanation = q.explanation || "";
      sql.push(`INSERT INTO questions (type,question,choices_json,answer_json,blank_count,course,unit,explanation,image_url,sort_order) VALUES (${v(q.type)},${v(q.question || "")},${v(JSON.stringify(choices))},${v(JSON.stringify(answers))},${blankCount},${v(course.title || "未分類")},${v(unit.title || "未分類")},${v(explanation)},${v(imageUrl)},${index});`);
    });
  }
}

await fs.writeFile("d1-seed.sql", sql.join("\n") + "\n", "utf8");
console.log("Generated d1-seed.sql");

function v(s) {
  return `'${String(s).replaceAll("'", "''")}'`;
}
