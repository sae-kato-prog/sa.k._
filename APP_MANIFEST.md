# APP_MANIFEST — TalkNest (トークネスト)

- Owner / Discord thread: 加藤良会さん / thread `1557614630610931782` ("外部研修用 / #slack / 1008")
- App name: TalkNest（トークネスト） — Slackクローン型 MVP
- gadget_id: `gadget_talknest_kato`
- Local directory: `/Users/abc/projects/kato-talknest`
- Backend: `backend/server.mjs` (Node標準ライブラリのみ, JSONファイル永続化)
- Data file: `backend/data/talknest_gadget_talknest_kato.json`
- Local port: `8791` (env: `TALKNEST_BACKEND_PORT`)
- Frontend: `frontend/index.html`（静的、backendをfetchで呼び出し）
- Public URL: 別途Cloudflare Tunnelで発行時にここへ追記

## 分離ルール
- 他スレッドのチャットアプリ（Hato「Chat App」/ AIZAWA「Linkroom」/ hosozawa「RoomLine」)とはディレクトリ・ポート・gadget_id・UI文言を完全に分離する。
- サンプルユーザーは架空名のみ使用し、実Discordユーザー名は使用しない。
- 保存・検索・更新・削除は必ず `gadget_id = gadget_talknest_kato` で絞る。別gadget_idの`x-gadget-id`リクエストは拒否する。

## 機能範囲(2026-10-08 合意)
- 実際に送受信・永続化できるMVP(簡易バックエンド + JSON DB)
- チャンネル一覧 + DM + メッセージ送受信
- スレッド返信
- スタンプ・リアクション
- 日本語UI、架空サンプルデータ

## サンプルユーザー(2026-10-08更新)
- takasu → 表示名「加藤良会」(営業企画部・管理者、依頼者本人の表示名に変更)
- minagawa → 皆川 蓮(制作部・メンバー)
- shinonome → 東雲 彩(カスタマーサクセス部・メンバー)
- fujimura → 藤村 悠(エンジニアリング部・メンバー、追加)
- kurosaki → 黒崎 遥(人事部・メンバー、追加)
- 全員共通パスワード: password

## バックエンド構成(2026-10-08 更新)
- ストレージ: PostgreSQL(JSONファイル保存から移行)
- DB名: `talknest_kato`(専用DB、他ガジェットと共用しない)
- DBロール: `talknest_app`(最小権限、`talknest_kato`のみ所有)
- 接続情報: `backend/.env`(`DATABASE_URL`)に保存、Markdown・チャットには記載しない
- スキーマ: `backend/schema.sql`(users/channels/dms/messages/thread_replies)
- バックアップ: `backend/backup.sh` 実行で `backend/backups/` に pg_dump 出力(.gitignore対象)
- 既存の他案件DB(`sabun01_dev`, `seafamiliar_slack_nikaidou`)とは別DBのため非干渉

