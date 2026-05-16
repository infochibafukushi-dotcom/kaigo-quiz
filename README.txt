# カイゴクイズ フロント再構築版

## 重要

このZIPはフロント専用です。
既存の Cloudflare Worker / D1 / R2 の保存方式は変更しません。

## GitHubにアップするファイル

- index.html
- style.css
- app.js

## D1で実行するSQL

- RESET_UNITS.sql

これは questions と units をリセットし、単元11件だけを新規作成します。

## Workerは触らない

worker.js はこのZIPに入れていません。
既存の本番Workerをそのまま使ってください。

## API

app.js は以下の既存Worker APIに接続します。

https://kaigo-quiz-save.info-chibafukushi.workers.dev

## 確認手順

1. GitHubのフロントファイルをこの3つで上書き
   - index.html
   - style.css
   - app.js

2. Cloudflare D1 Consoleで RESET_UNITS.sql を実行

3. サイトを開く

4. 管理画面で確認
   - 単元11件が表示される
   - 問題追加できる
   - 保存できる
   - 編集できる
   - 削除できる
   - 画像が保存できる

## 初期単元

1. 人間の尊厳と自立
2. 介護の基本
3. コミュニケーション技術
4. 社会の理解
5. 認知症の理解
6. 発達と老化の理解
7. 障害の理解
8. こころとからだのしくみ1
9. こころとからだのしくみ2
10. 介護過程1
11. 介護過程2
