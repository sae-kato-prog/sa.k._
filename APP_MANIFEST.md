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

## ファイルアップロード機能(2026-10-08 追加)
- 保存先: バックエンドサーバーのローカルストレージ(`backend/uploads/`、.gitignore対象)
- 制限: 10MB以下、許可形式は画像(png/jpeg/gif/webp)・PDF・Office文書・テキスト/CSVのみ
- メタデータはPostgreSQL `uploads` テーブルに保存(アップロード者・サイズ・MIME種別)
- API: `POST /api/uploads`(認証必須)、`GET /api/uploads/:id`(ファイル配信、画像はチャット画面にインライン表示)

## コミュニケーション方針(2026-10-08 確定)
- このスレッドでは「バックエンドURL」「フロントエンドURL」という呼び方は使わず、単に「ガジェットの画面URL」として案内する
- URLは指示がなくても作業報告時に毎回出力する(不要な場合はユーザーがその都度申告)
- GitHubリポジトリは `sae-kato-prog/sa.k._`(public)を正式に使用。旧 `sae-kato-prog/slack-sk` は使用しない

## 既読・未読管理機能(2026-10-08 追加)
- 粒度: ユーザー別の既読状況を一覧表示(誰が読んだか確認可能)
- 未読バッジ: 実装しない(既読状況表示のみ)
- テーブル: `read_receipts`(message_id, user_id, read_at の複合PK)
- API: `POST /api/messages/:id/read`(個別既読)、`POST /api/messages/read-bulk`(複数一括既読、ルーム表示時に自動実行)
- 画面: 自分以外が既読したメッセージに「既読 N名」表示、クリックで既読者一覧ポップオーバー表示

## メッセージ本文検索機能(2026-10-08 追加)
- UI: サイドバー既存の検索バーを拡張(別モーダルは設けない)
- 対象: 自分が参加する全チャンネル・DMを横断(メッセージ本文+チャンネル名+DM相手名)
- API: `GET /api/search?q=キーワード`(ILIKE部分一致、メッセージは最大50件・新しい順)
- 画面: サイドバー下部に「メッセージ検索結果」セクションを表示、クリックで該当ルームに移動(300msデバウンス)

## メンバー管理機能(2026-10-08 追加)
- 範囲: 各チャンネルへのメンバー追加・削除(全ユーザー一覧画面は作らない)
- 入口: チャンネル表示中のヘッダーに「メンバー」ボタンを追加(DM表示時は非表示)
- API: 既存の `PATCH /api/channels/:id/members` を利用、権限チェックを追加(非公開チャンネルは参加メンバーのみ編集可、最低1名は残す制約)
- 画面: モーダルで現在のメンバー一覧(削除ボタン付き)+追加可能なメンバー一覧(追加ボタン付き)を表示

## メンション機能(2026-10-08 追加)
- 入力: テキスト入力中に「@」でユーザー候補ポップオーバーが表示(矢印キー/Enter/Tabで選択、Escで閉じる)
- 表示: @ユーザー名をアクセントカラーで強調表示。自分宛てのメンションを含むメッセージ全体を薄いハイライト背景で目立たせる(別途通知一覧は作らない)
- バックエンド: メッセージの `@username` をusernameパターンで抽出し、`mentionedUserIds` としてメッセージ取得・送信レスポンスに含める(専用テーブルは持たず、テキストから都度解析)

## WebSocket/SSE即時配信(2026-10-08 試行→無効化)
- バックエンドに `/api/stream`(SSE)エンドポイントとブロードキャスト機構(message:new/deleted, reaction:updated, thread:new)を実装済み
- ローカル環境では即時配信が正常動作することを確認
- **現在の公開URL(Cloudflare Quick Tunnel/trycloudflare.com)はストリーミング応答をエッジ側でバッファするため、SSEイベントが届かない**ことを検証で確認
- ユーザー判断により、フロントエンドからのSSE呼び出し(`connectRealtimeStream()`)は無効化し、3秒ポーリングに全面ロールバック
- 固定URL(Named Tunnel等、バッファリングのないホスティング)に切り替えれば、既存のSSE実装をそのまま有効化できる(`selectRoom()`内で`connectRealtimeStream()`を呼ぶだけ)

## プロフィール編集・他ユーザープロフィール表示機能(2026-10-08 追加)
- 自分で編集可能: 表示名・部署・メールアドレス・アバター画像(画像アップロード方式)
- 役割(管理者/メンバー)の変更: 管理者のみ可能(自分自身の役割は変更不可。非管理者が自分を昇格させようとすると403で拒否)
- 入口: サイドバー自分のユーザーボックスをクリック→自分のプロフィール。メッセージ/スレッド内の他ユーザーのアイコンをクリック→そのユーザーのプロフィール(閲覧のみ、編集ボタンは本人にのみ表示)
- DB: `users.avatar_url` カラムを追加(既存の`/api/uploads`エンドポイントを再利用してアバター画像を保存)
- API: `PATCH /api/me`(自分の情報編集)、`GET /api/users/:id`(他ユーザー情報取得)、`PATCH /api/users/:id`(管理者による役割変更のみ)

