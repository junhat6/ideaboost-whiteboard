# ソース公開前の確認

ソースのPublic化は本番ボードの一般公開、ライセンスの選択、認証方式の変更ではない。本番URLは匿名編集能力を持つため秘密として扱う。以下は手順であり、公開・移行・削除を完了した記録ではない。

## Actionsの秘密境界

- `PRODUCTION_BASE_URL` の保存先は `production` environmentとする。workflowの `secrets.PRODUCTION_BASE_URL` 構文自体はenvironment限定ではなく、同名repository/organization secretがあれば参照され得る。公開前に同名secretがそれらのscopeにないことをreadbackで確認し、以後も重複登録しない。旧variableへのfallbackは設けない。全scopeで未設定なら既存のguardで配信前に停止する。
- stepの実行開始後に `add-mask` しても、そのstepのヘッダーやenv dumpより前には戻れない。GitHub secretによるrunnerの事前maskを使い、実値をrun本文へ補間しない。値を変換したログやartifactまで自動maskされる保証はないため、URL・pathの出力自体を避ける。
- PRは合成データの検証のみ。`pull_request_target` / `workflow_run` は使わない。配信と認証確認は固定repositoryのmain pushかつproduction環境に限定する。environmentのmainのみ/tag不可の保護を維持する。
- workflow tokenはcontents readのみ。checkoutは認証を永続化しない。配信は同じSHAを新規checkout/rebuildし、PR artifact/cacheを再利用しない。fork PRから本番secretを使える経路を追加しない。

## 承認後に行う移行

1. 対象は `junhat6/ideaboost-whiteboard` の `production` environment。既存variable `PRODUCTION_BASE_URL` の値を同名environment secretへ移す。値は端末出力・引数・チャット・ファイル・artifactへ出さず、安全な入力経路で登録する。
2. environment secretの登録成功と同名repository/organization secretの不在（適用されるorganization secretの可視範囲も含む）をreadbackで確認して旧variableを削除する。別scopeに同名secretが存在する、または不在を確認できない場合は停止し、勝手に削除・変更しない。URL自体・Workerのpath・App認証・Cloudflare token・branch policyは変えない。repository secretへのfallbackや権限拡張はしない。
3. 新workflowのguard、deploy、両smokeのログを確認し、env欄も含めてURLが露出しないことを値非表示の検査で確かめる。新規maskは過去ログを修復しない。

## Public化のゲート

- Git履歴と現在treeの秘密、個人情報、第三者由来コードを確認する。README/docsの個人メール削除だけでは履歴から消えない。履歴rewriteは別の影響と承認を伴う。
- 過去のActions runログ・artifact・添付・Issue/PR本文等を別途監査する。既存URLの露出があれば、削除とURL変更の必要性・影響を所有者と確認し、未解決のまま公開しない。ログ削除は取得済みコピーを回収しない。
- 本番URLを掲載した公開デモリンクやスクリーンショットを追加しない。公開後は匿名アクセスでrepoとActionsの見え方を確認する。
- ライセンスは所有者が選択する。公開のためにMIT等を自動追加しない。`package.json` の `private: true` はnpm誤公開防止でありGitHub visibilityではないため維持する。

## 根拠

- [GitHub: Using secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets): secret参照、fork由来workflowへのsecret制限。
- [GitHub: Workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#masking-a-value-in-a-log): maskは出力前に登録する必要がある。
- [GitHub: Secure use](https://docs.github.com/en/actions/reference/security/secure-use): 最小権限、変換後の値とログの監査、露出済み秘密の削除・rotation。

## この変更のローカル検証（2026-10-31）

基準はmain `85eb7a57124f18690cdc38901f8b8b6134713a7b` と同一tree `c37c43151df5060251dafc1725db826cca21acfe`。変更はworkflowと文書だけで、アプリ・テストの実装は不変。

- `npm run check`: lint/typecheck、224 + 178 = 402 unit/integrationが成功。buildは実行環境の既定Wrangler configディレクトリ欠落で停止したため、空の一時configディレクトリを使った `XDG_CONFIG_HOME=/tmp/whiteboard-public-prep-config npm run build` でdry-run成功を確認した。本番認証・配信は行っていない。
- YAML parseと一時assertionでsecret参照3箇所、vars参照なし、main/push/固定repo/environment条件、contents read、checkout認証非永続化を確認。`git diff --check` 成功。今回だけの確認のため恒久suiteには追加していない（ADR013）。
- browser suiteはこの文書/workflow変更では再実行していない。公開前の実Actionsログmask、secret移行、過去ログ整理、Public設定は別途確認が必要。
