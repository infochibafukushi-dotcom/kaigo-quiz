CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  question TEXT,
  choices_json TEXT NOT NULL DEFAULT '[]',
  answer_json TEXT NOT NULL DEFAULT '[]',
  blank_count INTEGER NOT NULL DEFAULT 0,
  course TEXT NOT NULL,
  unit TEXT NOT NULL,
  explanation TEXT,
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_questions_course_unit_sort
ON questions(course, unit, sort_order, id);
