# 本番導入・運用

## 承認待ちの具体的な操作

1. 対象Cloudflareアカウントを選び `wrangler login` でこのMacに継続認証を設定する。2026-10-26の `wrangler whoami` は未認証。勝手に実行しない。
2. このアプリ専用のAccess applicationとチーム許可ルールを作成する。候補はメールOTPと正確なチームメール一覧。Everyone、ドメイン全体、OTPで認証した全員への許可は禁止。既存アカウントに適切なIdPがあれば確認して選ぶ。許可メール一覧は未提供。
3. 既存専用App「Idea Boost Whiteboard」に本番用の鍵を1本追加し、Cloudflare Workerのsecret `GITHUB_APP_PRIVATE_KEY` へ登録する承認を得る。既存デモの鍵は保持し、Sites runtimeから取り出さない。追加発行・保存とも未承認・未実行。`wrangler secret put` はWorkerの新バージョンを即時デプロイする操作である。

GitHub CLIは既存のjunhat6認証を読み取り確認済み。追加のGitHub権限設定は不要。Cloudflare free/existing枠を優先し、有料契約や課金上限変更は別承認。

## 承認後に使用する具体的な設定経路

以下は手順のみ。承認前には実行しない。

1. ローカルのWrangler 4.152.0で `npx wrangler login --use-keyring --scopes account:read user:read workers_scripts:write` を実行。既定のlocalhost:8976コールバックとブラウザーOAuth認可を使う。CLIのヘルプでこのフラグを確認済み。許可画面の実際のscopeを照合し、承認されたアカウントに限定する。過剰な権限や追加scopeが必要なら停止して確認する。認証はOS keychainに保持し、リポジトリには置かない。成功後 `npx wrangler whoami` でアカウントを確認し、対象account_idを固定する。
2. 最初はGitHub秘密なし・Access設定なしのWorkerを配信しても、実装は全ルート503で拒否する。リソース名とworkers.dev hostnameを確定したら、Cloudflareの Workers & Pages → ideaboost-whiteboard → Access → Protect this Worker behind Access → All traffic を使用。**Protect all Workers は使わない**。指定メールだけのAllowポリシーにし、実際のIdP、セッション期限、既存hostname policyの優先関係を確認する。
3. Access team domain / application AUD / 確定hostname / 承認メールを設定する。APP_ORIGINは単一HTTPS origin。preview_urls:falseを維持。GitHub秘密を登録する前に匿名のHTML・assets・APIが返らないことを確認する。
4. GitHubの engineer-first → Settings → Developer settings → GitHub Apps → Idea Boost Whiteboard → Edit → Credentials → Key pairs → New key（公式の現在の経路）で本番用鍵を追加する。App ID 5473658であることを確かめる。Installed Appの設定や別App「Project Status Sync」は変更しない。既存鍵を削除しない。25鍵上限なら勝手に既存鍵を消さず停止する。
5. ダウンロードしたPEMは秘密として扱う。本文をツール出力・チャット・引数へ出さない。承認されたローカル保管先から標準入力で `npx wrangler secret put GITHUB_APP_PRIVATE_KEY --name ideaboost-whiteboard` に渡す。PKCS#1/PKCS#8はサーバーが両対応。保存は即時配信を伴うので、同じ承認対象として扱う。公開鍵fingerprintだけをGitHub表示と照合し、秘密値を記録しない。ローカル鍵の保管/消去は承認した取扱方針に従う。
6. デプロイ版とGit SHAを記録し、許可ユーザーの読み取り・非メンバー拒否を本番で確認する。

確認資料（2026-10-26）:
- https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps

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
