# 本番導入・運用

## 承認待ちの具体的な操作

1. 対象Cloudflareアカウントを選び `wrangler login` でこのMacに継続認証を設定する。2026-10-26の `wrangler whoami` は未認証。勝手に実行しない。
2. このアプリ専用のAccess applicationとチーム許可ルールを作成する。候補はメールOTPと正確なチームメール一覧。Everyone、ドメイン全体、OTPで認証した全員への許可は禁止。既存アカウントに適切なIdPがあれば確認して選ぶ。許可メール一覧は未提供。
3. 既存専用Appの秘密鍵をCloudflare Workerのsecret `GITHUB_APP_PRIVATE_KEY` へ登録する。Sites runtimeからの取り出し・移行は未承認。新規発行/rotationや他Appの変更は行わない。`wrangler secret put` はWorkerバージョンを更新する操作である。

GitHub CLIは既存のjunhat6認証を読み取り確認済み。追加のGitHub権限設定は不要。Cloudflare free/existing枠を優先し、有料契約や課金上限変更は別承認。

## 設定後のデプロイ手順

- `wrangler.jsonc` の worker名は `ideaboost-whiteboard`。App ID 5473658、installation 175301060 は公開識別子。秘密ではない。
- `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_EMAILS`, `APP_ORIGIN` を承認された本番値にする。APP_ORIGINは末尾スラッシュなしの単一HTTPS origin。
- Accessルールはアプリ全体を保護。Worker内のJWT検証はAccessルーティングとは別の防御。全URLでworker-first、preview_urls:false。別ホストはJWTが有効でも拒否する。
- 最初の配信は秘密・アクセス設定と一緒に扱い、未認証のURLでHTML/JS/APIが漏れないことを先に確認。
- 同じコミットで `npm ci && npm run check && npm run test:e2e` 後、既存の承認済みCLIから `npm run deploy`。まず手動デプロイだけ。CIは検証専用。Cloudflare tokenをGitHubへ登録する自動配信は新たな継続権限のため別承認。
- 公開されたworker URLとGit SHA、Cloudflare version IDを記録。

## 本番スモーク試験

匿名、許可外アカウント、期限切れJWT、別audience、偽ヘッダー、別hostnameで `/`, `/app.js`, `/styles.css`, `/api/health`, `/api/board` のアクセスが拒否されること。Accessログインへのredirectも許容するが本文やアセットを返さないこと。

許可ユーザーでログインし、実ボードの読み取り、アバター、PBI選択、全画面、45秒更新を確認。実Issue書き込み試験は自動でしない。使い捨てテストIssueを別途承認してもらうか、実変更は通常のチーム利用として扱う。モック試験を実接続書き込み成功と報告しない。

## 障害対応

- 401: Accessで再ログイン。403: チーム許可または本番originを管理者が確認。503: 設定や公開JWKSへの通信を確認。秘密値をログへ出さない。
- 409: 他の変更と競合。入力が必要ならコピーし、最新を取得してから改めて編集。
- 部分保存/結果不明: GitHubのIssueとProjectを直接確認。ロールバックや再送を機械的に実行しない。ボードは再取得まで保存を停止。
- token失効: App installationと既存権限を確認。秘密鍵rotationは別承認。
- rollback: 直前の検証済みWorker版を選ぶ。アプリのrollbackはGitHubデータ変更を取り消さない。Access設定変更も別管理。
- メンバー退会: AccessポリシーとWorker ALLOWED_EMAILSの両方から除外し、Accessセッションを失効させる。操作には明示承認が必要。

## 運用上の限界

同一isolateのロック/idempotencyは再起動や別isolateへまたがらない。GitHub直接編集・自動化との原子性はない。長いタイトルは完全行単位でカード内スクロール、本文はドロワーで全文を読む。PBI選択は個別ブラウザー。チーム共通スプリント定義、監査DB、WebSocketは現在範囲外。
