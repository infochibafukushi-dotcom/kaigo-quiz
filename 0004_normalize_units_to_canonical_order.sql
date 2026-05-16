UPDATE questions
SET course = '介護福祉士実務者研修',
    unit = '障害の理解',
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (138, 142, 143, 144, 145);
