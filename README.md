# カイゴクイズ

介護福祉士実務者研修向けの一問一答WEBアプリです。

## フロントエンド

- GitHub Pages で配信

## バックエンド（新構成）

- Cloudflare Workers: API
- Cloudflare D1: 問題データ永続化
- Cloudflare R2: 問題画像保存

## セットアップ

1. `wrangler.toml` の `database_id` と `R2_PUBLIC_BASE_URL` を設定
2. D1マイグレーションを実行
   - `wrangler d1 execute kaigo-quiz --file migrations/0001_questions.sql`
3. `questions.json` から移行SQLを生成
   - `node scripts/migrate-questions-to-d1.mjs questions.json`
4. 生成したSQLをD1へ反映
   - `wrangler d1 execute kaigo-quiz --file d1-seed.sql`
5. `app.js` の `API_BASE` を Workers URL に置換

## questions.json（134問）を復元元としてD1へ復元する手順

1. seed SQLを再生成  
   - `node scripts/migrate-questions-to-d1.mjs questions.json`
2. D1へ反映（既存 `questions` を置換）  
   - `wrangler d1 execute kaigo-quiz --file d1-seed.sql --remote`
3. 件数照合  
   - `node scripts/verify-restore-counts.mjs https://kaigo-quiz-save.info-chibafukushi.workers.dev questions.json`
4. 期待値  
   - `jsonCount = 134`
   - `seedInsertCount = 134`
   - `apiCount = 134`
