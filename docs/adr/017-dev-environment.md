# 017: 付箋とリモート MCP を試す dev 環境を、本番と別の Worker に置く

2026-11-25（#8 M2.5）。本番は付箋が無効（`TEAM_NOTES_ENABLED: "false"`、ADR 016）。実際の AI クライアント（claude.ai・ChatGPT のコネクター、Claude Code、Codex）から付箋と、M2 で作るリモート MCP（`/mcp`）を試す場所が要る。今まで dev / staging は無かった。

## 判断

- `wrangler.jsonc` に `env.dev` を置き、Worker 名を `ideaboost-whiteboard-dev` にする。人が `npx wrangler deploy --env dev` したときだけ使う。
- dev では `TEAM_NOTES_ENABLED: "true"`、`GITHUB_WRITES: "disabled"`。GitHub App の ID・installation・鍵は置かない。
- 認証は本番と同じチームモード（`authenticate()`）のまま。dev は Cloudflare Access の背後に置く前提で、Access の設定と `ACCESS_*`・`ALLOWED_EMAILS`・`APP_ORIGIN` の登録は人が行う（[runbooks/login-required.md](../runbooks/login-required.md) の 9 章）。

## 本番とデータが混ざらない理由

- Durable Object の namespace は Worker（script）ごとに作られる。dev は別名の Worker なので、`IssueCoordinator`・`HistoryCoordinator`・`TeamNotesCoordinator` の保存先は本番と別になる。dev の付箋は本番に出ず、本番の付箋・要求記録も dev から見えない。
- `durable_objects` と `vars` は wrangler の env へ継承されないため、`env.dev` に書き直した。`migrations`（v1〜v3）はトップレベルのものが継承され、dev の Worker の初回 deploy で 3 つの class が dev 側に新しく作られる。今後 migration を足すときはトップレベルに 1 回書けば、本番と dev のそれぞれが次の deploy で適用する（tag は Worker ごとに記録される）。
- `ratelimits`（`PUBLIC_LIMITER`）も継承されない。dev には置かない（下記）。dev の `ratelimits` は、M2 で足した MCP の書き込みの利用者ごとの上限 `MCP_LIMITER` だけ（ADR 018）。
- `routes` は書かない。dev は自分の workers.dev ホストだけで動く。本番 URL・アカウント ID・48 桁 path・secret は dev 側に写さない。
- 本番の設定値は変えていない。`wrangler` で解決した本番の設定（名前・DO・migrations・ratelimits・assets・vars）を変更の前後で比べ、同一であることを確かめた（変更記録）。wrangler は「トップレベルの vars・ratelimits が env.dev に無い」という警告を出すが、これは意図どおり（本番の値を dev へ写さないため）。

## 実チームの Issue へ書かない仕組み

二重に止める。

1. **資格を渡さない**: dev には GitHub App の ID・installation・鍵が無い。`handleApi` は `github_not_configured`（503）で GitHub を一切呼ばない。ボードは読み込めず、付箋の棚だけが動く。
2. **変数で書き込みを止める**: `GITHUB_WRITES` が置かれていて値が `"enabled"` でなければ、GitHub への書き込みを 403 `github_writes_disabled` で止める。止める場所は 3 か所で、同じ判定（`githubWritesDisabled`）を使う。
   - 経路（Worker）: `worker/index.ts` は `POST /api/issues/:n` と `/comments` を `MUTATIONS` の DO に入れる前に止める。DO の queue・要求記録にも残らない。
   - 経路（`handleApi`）: `server/github.mjs` は同じ POST を、本文を読む前・GitHub を読む前に止める。DO を経由した要求もここを通る。
   - 送り先（`api()`）: GitHub へ送る唯一の口。GET と、確実に読み取りと言える GraphQL（`isGithubRead`）だけを通し、それ以外（REST の PATCH/POST/DELETE、GraphQL の mutation、判別できない GraphQL）は token を取る前に止める。GraphQL は構文解析せず、疑わしいものを書き込みとみなす（誤って止めてよい、fail closed）: query が文字列でない、`query` で始まらない、mutation / subscription という語が文書のどこかにある（大文字小文字・コメント・文字列の中を問わない）、query と variables 以外の項目（operationName など）がある。理由: `query A { … } mutation B { … }` に operationName `B` を付けると、先頭が `query` でも mutation が実行される。今の読み取りは全て `query` で始まり、operationName を付けず、名前の中の `Mutation`（`MutationContext`）は語の境界で区別するので止まらない。installation token の取得（access_tokens）は `api()` を通らないので止まらない。`gql()` も `api()` を通る。
   - 送り先でも止める理由: M2 の `/mcp` などが `save()` やコメントの write を経路を通さずに呼ぶと、経路の判定だけでは素通りする。送り先で止めれば、MCP 経由でも同じ判定を必ず通る。そのため、GitHub へ `api()` を通さずに fetch するコードを足さない（今 `fetcher` を直接使うのは token の取得だけ）。経路でも止めるのは、GitHub を読む前に、結果不明でない明確な 403 を返すため。
   - 何も送らずに止めるので、結果不明（ambiguous）ではない。利用者に再取得を求める必要もない。
   - 未設定の本番だけが従来どおり書ける。値の綴り違い（`"disable"`・空文字など）も止める側に倒す。

1 だけでは足りない理由: 後で誰かが「dev でもボードを見たい」と鍵を登録すると、そのまま実 Issue へ書けてしまう。2 があれば、鍵を登録しても書き込みは閉じたまま。

### 読み取り（本番と同じ GitHub か、fixture か）

dev は GitHub を読まない。fixture モードも作らない。理由:

- 付箋とリモート MCP の検証に Issue の中身は要らない（付箋は DO にだけ保存する、ADR 016）。
- 本番と同じ GitHub を読むには、本番の GitHub App 鍵を dev へ写すか、別の App を作る必要がある。どちらも secret の移行・権限拡張で、明示承認が要る（AGENTS.md）。
- fixture モードは本番のコードに試験専用の分岐を増やす。ボードの見た目の確認は、既存の静的プレビュー（`scripts/preview.mjs`）と e2e で足りている。

dev でボードも読みたくなったら、読み取り専用（`issues: read`）の別の GitHub App を作る案を人が決める。そのときも `GITHUB_WRITES: "disabled"` は外さない。

## 認証の前提（fail closed）

- dev は `AUTH_MODE` を持たず、チームモードで動く。`ACCESS_TEAM_DOMAIN`・`ACCESS_AUD`・`ALLOWED_EMAILS`・`APP_ORIGIN` のどれかが欠けると、HTML を含む全ルートが 503 `access_not_configured`。Access を設定する前に deploy されても、匿名では何も読めず書けない。
- **dev で public-temporary は使わない**。付箋とリモート MCP の目的は「誰が書いたか」を区別することで、匿名の主体では検証にならない。誤って `AUTH_MODE=public-temporary` を入れても、dev には `PUBLIC_LIMITER` が無いので（`MCP_LIMITER` は別の binding で、匿名公開の枠にはならない） `/api/*` は 503 `rate_limit_not_configured` で閉じる（`PUBLIC_PATH` が無ければ全体が 503）。ただし `PUBLIC_PATH` と `APP_ORIGIN` まで入れた場合、`/b/<path>/` の HTML・CSS・JS（データを含まない画面の外枠）は匿名で見える。中身（付箋・Issue）は API が閉じているので出ない。
- Access の許可一覧は本番のメンバーと同じか、その一部にする。dev の付箋はチームの外に見せない前提で扱う。

## 自動では deploy しない

- CI の deploy job は main への push だけで動き、`wrangler deploy --env="" --name ideaboost-whiteboard --keep-vars` とトップレベル（本番）と本番の名前を明示している。dev は deploy されない。
- `--env=""` を付けた理由: `env.dev` を足すと、wrangler は `--env` の無い deploy に「Multiple environments」の警告を出す。本番を明示して警告を消し、意図しない env への deploy を防ぐ。`npm run deploy` と `npm run build`（dry-run）も同じにした。本番の名前・値・bindings は変わらない（dry-run の bindings 表を前後で比較して同一）。
- release ループ（`npm run release`）は昇格 PR を作るだけで deploy しない。develop-health は deploy しない。
- dev の deploy・削除は人が手元で行う。

## 人がやること（R3）

runbook の 9 章に手順を置いた。dev の初回 deploy、workers.dev への Access の付与とポリシー、`ACCESS_*`・`ALLOWED_EMAILS`・`APP_ORIGIN` の secret 登録、managed OAuth の検証、切り戻し（dev Worker の削除）。どれも外部設定・secret の登録なので、agent は行わない。

## 採用しなかった案

- 同じ Worker の preview URL・別ルートで dev を動かす: DO の namespace が本番と共通になり、付箋のデータが混ざる。
- dev でも本番の GitHub App 鍵を使い、書き込みだけ止める: secret の移行に当たり承認が要る。止める仕組みが 1 枚になる。
- `GITHUB_WRITES` を「`"enabled"` のときだけ書ける」にする: 本番の設定値を変える必要があり、変更を入れた瞬間に本番の書き込みが止まる危険がある。代わりに「置いたら止まり、綴り違いも止まる」にした。
- dev に public-temporary を許す: 匿名で書ける付箋がもう 1 か所増える。検証の目的（利用者の区別）にも合わない。

## 検証

- `server/github-writes.test.mjs`: `GITHUB_WRITES` の値ごとの判定、停止中は Issue の変更・Status・コメントを GitHub へ 1 件も送らず 403、未設定なら従来どおり書けること。送り先（`api()`/`gql()` を経路を通さずに直接呼ぶ）でも、REST の PATCH/POST/DELETE・GraphQL の mutation・`query` で始まらない GraphQL を token の取得も含めて何も送らずに止め、読み取りは止めないこと。未設定なら同じ呼び出しが従来どおり書けること。operationName で後ろの mutation を選ぶ文書・複数 operation・subscription・大文字・コメントや文字列の中の mutation・文字列でない query・想定外の項目も止め、未設定なら同じものを従来どおり送ること。本番の設定で読み取りと書き込みの経路を動かして送られた GraphQL を全て集め、読み取りは全て通り、止まるのは実際の mutation だけであること。
- `tests/dev-env.test.ts`: `wrangler.jsonc` の `env.dev` が別名・付箋有効・書き込み停止で、GitHub の資格・公開モード・匿名公開の rate limit（`PUBLIC_LIMITER`）を持たず、rate limit は `MCP_LIMITER` だけであること。本番は付箋無効のまま。dev の Worker は付箋を通し、Issue の変更を DO に入れずに 403。Access 未設定なら全ルート 503、public-temporary にしても API は 503。
- 一度だけの確認（`.validation/` に記録、git に入れない）: `wrangler deploy --dry-run` を本番と `--env dev` で実行し、本番の設定が変更前と同一。ローカルの `wrangler dev --env dev` へ curl で、Access 未設定の全 503、付箋 API の 200、Issue の変更とコメントの 403。
