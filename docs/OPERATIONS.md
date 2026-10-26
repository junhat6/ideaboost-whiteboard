# 本番導入・運用

## 現在の承認と状態

2026-10-26: Cloudflare対象は junhat6@gmail.com。ユーザーは複雑なURLでの一時的な**匿名閲覧・匿名編集**を、URLを知った誰でも実Issueを変更できると確認したうえで承認した。Access allowlistの設定はしない。Source repositoryはprivateのまま。

既存GitHub App「Idea Boost Whiteboard」App ID 5473658 / installation 175301060に本番鍵を1本追加し、Cloudflare Worker secretへ保存する操作も承認済み。既存デモ鍵は保持し、Sites secretを抽出しない。別App Project Status Syncは変更しない。

Cloudflare OAuthとGitHub sudo本人確認は完了。指定アカウントだけで4 scopeを付与し、Freeプランのまま配信済み。追加鍵はCloudflareのGITHUB_APP_PRIVATE_KEYへ登録済みで、一時ダウンロードは公開fingerprint照合後に削除した。既存デモ鍵は保持。GitHub正本の読取と本番UIを検証済み。配信版と検証範囲はDEPLOYMENT.mdを参照。

## 導入手順

1. `npx wrangler login --use-keyring --scopes account:read user:read workers_scripts:write`。ChromeのCloudflareログインを本人が完了し、Wrangler consentのaccount:read / user:read / workers_scripts:write / offline_accessを確認する。既定callback localhost:8976。成功後 `npx wrangler whoami` で対象メールとaccount_idを照合する。追加scopeは勝手に広げない。
2. account_idを固定。既存/Free枠を確認し、有料契約や課金上限変更はしない。SQLite Durable ObjectsとRate Limiting bindingを使う。Rate Limit namespace 5473658に既存用途がないか確認し、必要なら未使用の専用整数を選ぶ。
3. `AUTH_MODE=public-temporary`、`APP_ORIGIN=https://<確定hostname>`、`PUBLIC_PATH=/b/<暗号学的乱数24byteのlowercase hex>` を設定する。pathは認証情報ではないが、リポジトリへ実URLを固定しない。preview_urls:false、run_worker_first:true。APP_ORIGIN外とpath外は拒否。
4. GitHub engineer-first → Settings → Developer settings → GitHub Apps → Idea Boost Whiteboard → Edit → Credentials → Key pairs → New key。App IDを照合し、既存鍵を削除しない。sudo/passkeyが必要なら本人へ引き継ぐ。25鍵上限なら停止する。
5. ダウンロードPEMを秘密として扱い、本文をツール出力・チャット・引数へ出さない。標準入力で `npx wrangler secret put GITHUB_APP_PRIVATE_KEY --name ideaboost-whiteboard`。この操作は新Worker版を即時デプロイする。PKCS#1/PKCS#8対応。初回はGitHub secretなしでWorkerを作り、path/host/Originの境界を確認してから登録する。
6. `npm ci && npm run check && npm run test:e2e`。同じcommitから承認済みCLIで `npm run deploy`。CIは検証専用。新しいGitHub Actions deploy tokenの付与は別承認。
7. URL、Git SHA、Cloudflare version IDを記録。本番読み取りを確認する。実IssueをQA目的で書き換えない。

## 公開モードの意味と防御

長いパス・noindex・no-referrerは発見を抑える補助であり、本人確認や編集権限ではない。アプリは匿名の全利用者を一つのpublic-anonymous主体として扱い、誰が保存したかを識別できない。GitHubにはAppの代理操作として記録される。

公開APIは30 requests/60秒のCloudflare rate limitをread/write別の共有キーで適用。これは各Cloudflare location内で近似的に計数され、全世界の厳密上限やDDoS完全防御ではない。Origin制限はブラウザーからのcross-site送信対策であり、直接クライアントの意図的な編集を止めない。

固定対象以外のIssue/Projectをプロキシしない。読取前後にrepo isPrivate=false、Project public=trueを要求する。公開範囲の変更と応答の間の外部競合まで原子的にはできない。秘密鍵・tokenはサーバーだけ。全応答no-store、Markdownは原文テキスト。将来チーム認証へ移行する場合はpublic-temporaryを無効にし、保持しているJWT/allowlist境界を設定・検証する。

## 本番スモーク

- root、誤path、旧preview/別hostnameでHTML/APIが露出しない。
- 正しい公開pathでは匿名のHTML/assets/boardが読める。メンバーだけと誤表示しない。
- 偽認証ヘッダー、別OriginのPOST、任意Issue/Project、入力過大を拒否。レート上限で429。
- GitHub publicフラグ検証、6 PBI、原文、アバター、全画面、45秒更新。
- 同時保存/部分保存/通信中断はmock試験を用い、実Issue書込成功と混同しない。

## 障害・保存停止

409競合は最新取得後に新しい編集を行う。`mutation_outcome_unresolved` は未確定の外部処理が残るため、そのIssueの新IDも拒否する。読み直しだけでは解除しない。管理者がGitHub正本・履歴・外部処理の終息を確認し、承認された保守変更で対象Objectのpendingを処理する必要がある。現在公開リセットAPIや自動TTLはなく、コードによる保守が必要という運用制約がある。元request記録を残し、再送・namespace変更・全記録削除をしない。

各Issue10,000記録で `mutation_ledger_capacity`。履歴を無条件に消さず保持方針を見直す。共有調停なしの旧版へrollbackすると同時保存の保証が失われるため戻さない。Worker rollbackはGitHub上の変更を戻さない。

## 参照

- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps
