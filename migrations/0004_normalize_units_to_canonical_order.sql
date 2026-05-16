BEGIN TRANSACTION;

-- 1) 既存問題データの単元名を先に正規化（問題データ保持）
UPDATE questions SET unit = '発達と老化の理解', updated_at = CURRENT_TIMESTAMP WHERE unit = '老化の理解';
UPDATE questions SET unit = 'こころとからだのしくみ1', updated_at = CURRENT_TIMESTAMP WHERE unit IN ('こころとからだのしくみ', 'こころとからだのしくみ①', 'こころとからだのしくみ１', 'こころとからだのしくみⅠ');
UPDATE questions SET unit = 'こころとからだのしくみ2', updated_at = CURRENT_TIMESTAMP WHERE unit IN ('こころとからだのしくみⅡ', 'こころとからだのしくみ②', 'こころとからだのしくみ２');
UPDATE questions SET unit = '介護過程1', updated_at = CURRENT_TIMESTAMP WHERE unit IN ('介護過程①', '介護過程１', '介護過程Ⅰ');
UPDATE questions SET unit = '介護過程2', updated_at = CURRENT_TIMESTAMP WHERE unit IN ('介護過程②', '介護過程２', '介護過程Ⅱ');

-- 2) 単元テーブルを正規化（同一 course 内の重複は統合）
DELETE FROM units
WHERE title = '老化の理解'
  AND EXISTS (SELECT 1 FROM units u2 WHERE u2.course = units.course AND u2.title = '発達と老化の理解');
UPDATE OR IGNORE units SET title = '発達と老化の理解', updated_at = CURRENT_TIMESTAMP WHERE title = '老化の理解';

DELETE FROM units
WHERE title IN ('こころとからだのしくみ', 'こころとからだのしくみ①', 'こころとからだのしくみ１', 'こころとからだのしくみⅠ')
  AND EXISTS (SELECT 1 FROM units u2 WHERE u2.course = units.course AND u2.title = 'こころとからだのしくみ1');
UPDATE OR IGNORE units SET title = 'こころとからだのしくみ1', updated_at = CURRENT_TIMESTAMP
WHERE title IN ('こころとからだのしくみ', 'こころとからだのしくみ①', 'こころとからだのしくみ１', 'こころとからだのしくみⅠ');

DELETE FROM units
WHERE title IN ('こころとからだのしくみⅡ', 'こころとからだのしくみ②', 'こころとからだのしくみ２')
  AND EXISTS (SELECT 1 FROM units u2 WHERE u2.course = units.course AND u2.title = 'こころとからだのしくみ2');
UPDATE OR IGNORE units SET title = 'こころとからだのしくみ2', updated_at = CURRENT_TIMESTAMP
WHERE title IN ('こころとからだのしくみⅡ', 'こころとからだのしくみ②', 'こころとからだのしくみ２');

DELETE FROM units
WHERE title IN ('介護過程①', '介護過程１', '介護過程Ⅰ')
  AND EXISTS (SELECT 1 FROM units u2 WHERE u2.course = units.course AND u2.title = '介護過程1');
UPDATE OR IGNORE units SET title = '介護過程1', updated_at = CURRENT_TIMESTAMP
WHERE title IN ('介護過程①', '介護過程１', '介護過程Ⅰ');

DELETE FROM units
WHERE title IN ('介護過程②', '介護過程２', '介護過程Ⅱ')
  AND EXISTS (SELECT 1 FROM units u2 WHERE u2.course = units.course AND u2.title = '介護過程2');
UPDATE OR IGNORE units SET title = '介護過程2', updated_at = CURRENT_TIMESTAMP
WHERE title IN ('介護過程②', '介護過程２', '介護過程Ⅱ');

-- 3) 不足単元を各 course に補完作成（重複は UNIQUE 制約 + OR IGNORE で回避）
INSERT OR IGNORE INTO units (course, title, is_visible)
SELECT course, '人間の尊厳と自立', 1 FROM (SELECT DISTINCT course FROM units);
INSERT OR IGNORE INTO units (course, title, is_visible)
SELECT course, '介護の基本', 1 FROM (SELECT DISTINCT course FROM units);
INSERT OR IGNORE INTO units (course, title, is_visible)
SELECT course, 'コミュニケーション技術', 1 FROM (SELECT DISTINCT course FROM units);
INSERT OR IGNORE INTO units (course, title, is_visible)
SELECT course, '社会の理解', 1 FROM (SELECT DISTINCT course FROM units);
INSERT OR IGNORE INTO units (course, title, is_visible)
SELECT course, '認知症の理解', 1 FROM (SELECT DISTINCT course FROM units);
INSERT OR IGNORE INTO units (course, title, is_visible)
SELECT course, '発達と老化の理解', 1 FROM (SELECT DISTINCT course FROM units);
INSERT OR IGNORE INTO units (course, title, is_visible)
SELECT course, '障害の理解', 1 FROM (SELECT DISTINCT course FROM units);
INSERT OR IGNORE INTO units (course, title, is_visible)
SELECT course, 'こころとからだのしくみ1', 1 FROM (SELECT DISTINCT course FROM units);
INSERT OR IGNORE INTO units (course, title, is_visible)
SELECT course, 'こころとからだのしくみ2', 1 FROM (SELECT DISTINCT course FROM units);
INSERT OR IGNORE INTO units (course, title, is_visible)
SELECT course, '介護過程1', 1 FROM (SELECT DISTINCT course FROM units);
INSERT OR IGNORE INTO units (course, title, is_visible)
SELECT course, '介護過程2', 1 FROM (SELECT DISTINCT course FROM units);

COMMIT;
