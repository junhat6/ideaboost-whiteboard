# GitHub Actionsからの本番配信

## 状態

2026-10-27、ユーザーの明示承認と初回認証設定のreadbackを受け、production環境でmain pushのCI成功後だけ配信するjobを準備した。初回本番配信の成否は対象commitのActions結果と配信記録で確認する。本書の設定確認を配信成功と混同しない。

開発と検証はdotのcloudで行い、通常の配信はGitHub-hosted runnerから既存Cloudflare Workerへ送る。Mac miniに依存しない。初回認証設定のための限定利用は通常開発・配信の許可とは区別する。

## 認証と承認済み範囲

- Cloudflare account `29a0469ba7d11f29ac94e3ed41f388a8`（非秘密）、既存Worker `ideaboost-whiteboard` 単体のEditorを付与したaccount-owned API token。旧Workers Scripts Editのaccount全体権限へ拡大しない。
- ユーザー承認の有効期限は **2027-03-31 23:59 JST（14:59 UTC、設定画面の分単位表示）**。自動延長しない。token名は `ideaboost-whiteboard-github-actions-20270331`、単体Worker Editorと期限は作成時readback済み。値はcloudへ移送していない。
- Editorには配信・rollbackだけでなく、対象Workerの設定・secret管理・DOデータ操作も含まれる。新Worker作成/削除、他Worker、DNS/Zone、他製品の追加権限は付けない。[Worker権限](https://developers.cloudflare.com/workers/authorization/workers/)、[DO権限](https://developers.cloudflare.com/workers/authorization/durable-objects/)
- `CLOUDFLARE_API_TOKEN` はGitHub Actions secretへ直接登録する。既存Mac miniの認証やGitHub App秘密鍵はコピーしない。App秘密鍵等の既存runtime secretsはCloudflareに残す。token値をチャット、repo、artifact、ログ、cloud作業環境へ保存しない。[公式Actions認証](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- 非秘密のActions variablesは `CLOUDFLARE_ACCOUNT_ID` と `PRODUCTION_BASE_URL`。URLは既存host・既存48hex公開pathの末尾 `/` までを登録し、repo本文には固定しない。

## GitHub側の境界

private repoでproduction environmentとそのbranch policyを使える既存planなら、secret/variablesをproductionへ置き、配信jobに `environment: production`、許可branchはmainだけを設定する。無料privateではこの機能を利用できないため、有料planへ勝手に変更しない。[GitHub environmentの利用条件](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

今回の設定は **production environment**。`CLOUDFLARE_API_TOKEN` と2つのvariablesの登録、main branchのみ/tag不可のbranch policyを初回設定担当がreadbackした。有料契約の変更なし。repository secretへのfallbackは使用していない。

無課金代替のrepository secret案は、**repo書込権者全員を信頼する**ことが前提。main条件はこのworkflowの誤配信を防ぐが、repo secretをbranch単位で強制隔離するものではない。書込権者は別workflowを作ってsecretを使用できる。厳密なbranch制限が必要なら、利用可能な環境保護を確認するまで有効化しない。[GitHubのsecret境界](https://docs.github.com/en/actions/reference/security/secure-use)

## 配信経路

1. 同じworkflowの `check` でlint/typecheck/unit/buildと全browser fixtureを実行。PRはこれだけで、配信jobはpush/main/固定repo以外では起動しない。`pull_request_target` / `workflow_run` は使用しない。
2. `needs: [check, auth-check]` により同じrunの検証成功だけを受ける。auth-checkはmain限定・checkout/依存実行なしで、secretの形式確認と固定account/WorkerへのGETだけを行う。ログは真偽とHTTP statusのみ、値・長さ・hash・prefix実文字列は出さない。配信jobはそのrunの完全SHAをcheckoutし、実HEAD一致とGitHubの現在main一致を配信直前に検証する。古いrunの再実行はmainが進んでいれば停止する。
3. 配信jobはGitHub-hosted runner。公式actionsを完全commit SHAに固定し、deploy用のPR artifactや共有npm cacheは使わない。GitHub tokenはcontents readのみ。依存導入とbundle生成にはCloudflare tokenを渡さない。
4. `ideaboost-whiteboard-production` concurrency groupで配信を直列化。進行中の配信は新pushでcancelしない。main変更とCloudflare publishを跨ぐ原子的保証はないため、開始後に届く新commitは次のCI・配信で反映する。
5. `wrangler deployments list --json` で直前Version IDをログに残し、lockfile内のWranglerで `deploy --keep-vars --tag <checked SHA>` を実行。既存vars/runtime secrets/DO bindingsを保持し、secret uploadはしない。未設定tokenは配信前に失敗する。[Wrangler deploy](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
6. 既存公開pathへGETだけを送り、healthの設定と配信manifestに列挙した全assetのSHA-256一致を確認。配信伝播を最大3分待つ。実Issue・日程・履歴のQA mutationは行わない。healthはGitHub正本の全動作やDO alarmを検証したことにはならない。

## 失敗と戻し方

- CI失敗は配信なし。credential不足・権限不足では権限を広げず停止する。
- 配信commandの結果不明、または配信後smoke失敗はjobを失敗にし、自動で再配信・rollbackしない。記録されたVersion IDとCloudflareの現在deploymentを先に照合する。
- 通常の修正はGitHub上で原因commitをrevertするかcloudで修正し、同じCI→配信経路を通す。これもMac mini不要。
- 緊急rollbackは直前の確認済みVersion IDを明示して `wrangler rollback <version-id> --yes` を使う別途承認済みのActions手順、またはCloudflare dashboardから行う。現在のworkflowは任意versionを入力するrollback入口を持たない。
- rollbackは原則直近100version内。DO classの追加/削除などmigrationを跨げない場合があり、保存データを巻き戻す処理でもない。対応可否を確認せず実行しない。[Cloudflare rollback制約](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

## 検証範囲

`server/deployment-check.test.mjs` は固定scope・PR/他branch拒否・古いmain拒否・GET限定smoke・asset不一致/設定消失を合成応答で検証する。token登録、本物の配信、配信後の本番確認は別途結果を記録する。secret名とplanの取得に対応しないconnectorを、未登録の証拠にしない。
