# カイゴクイズ

介護福祉士実務者研修向けの一問一答WEBアプリです。

## GitHub Pages公開方法

Settings → Pages → Deploy from a branch → main / root

## 編集方法

左上の「管理」から問題と答えを編集できます。

## 保存の仕様（GitHub本番保存）

管理画面の保存ボタンは、保存API（Cloudflare Worker）経由で GitHub API を呼び出し、
`infochibafukushi-dotcom/kaigo-quiz` の `questions.json` を直接更新します。

- 保存（単元単位）: scope=`unit`
- 保存（コース単位）: scope=`course`

保存成功時は「GitHubへ保存しました」を表示します。
保存失敗時はエラー内容を表示します。

## セキュリティ

GitHub Personal Access Token はブラウザJSへ直書き禁止です。
`REMOTE_SAVE_WORKER_EXAMPLE.js` の Worker 側環境変数 `GITHUB_TOKEN` に設定してください。

## Worker 環境変数

- `GITHUB_TOKEN`（必須）
- `WORKER_API_KEY`（任意: ブラウザ→Worker 認証）
- `GITHUB_BRANCH`（任意: 既定 `main`）

## 実装メモ

Worker は保存時に GitHub Contents API から `questions.json` の最新 SHA を取得してから PUT するため、
競合回避しながら更新します。
