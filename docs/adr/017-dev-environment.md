# 017: 付箋とリモート MCP を試す dev 環境を、本番と別の Worker に置く

2026-11-25（#8 M2.5）。本番は付箋が無効（`TEAM_NOTES_ENABLED: "false"`、ADR 016）。実際の AI クライアント（claude.ai・ChatGPT のコネクター、Claude Code、Codex）から付箋と、M2 で作るリモート MCP（`/mcp`）を試す場所が要る。今まで dev / staging は無かった。

## 判断

- `wrangler.jsonc` に `env.dev` を置き、Worker 名を `ideaboost-whiteboard-dev` にする。人が `npx wrangler deploy --env dev` したときだけ使う。
- dev では `TEAM_NOTES_ENABLED: "true"`、`GITHUB_WRITES: "disabled"`。GitHub App の ID・installation・鍵は置かない。
- 認証は本番と同じチームモード（`authenticate()`）のまま。dev は Cloudflare Access の背後に置く前提で、Access の設定と `ACCESS_*`・`ALLOWED_EMAILS`・`APP_ORIGIN` の登録は人が行う（[runbooks/login-required.md](../runbooks/login-required.md) の 9 章）。

## 本番とデータが混ざらない理由

- Durable Object の namespace は Worker（script）ごとに作られる。dev は別名の Worker なので、`IssueCoordinator`・`HistoryCoordinator`・`TeamNotesCoordinator` の保存先は本番と別になる。dev の付箋は本番に出ず、本番の付箋・要求記録も dev から見えない。
- `durable_objects` と `vars` は wrangler の env へ継承されないため、`env.dev` に書き直した。`migrations`（v1〜v3）はトップレベルのものが継承され、dev の Worker の初回 deploy で 3 つの class が dev 側に新しく作られる。今後 migration を足すときはトップレベルに 1 回書けば、本番と dev のそれぞれが次の deploy で適用する（tag は Worker ごとに記録される）。
- `ratelimits`（`PUBLIC_LIMITER`）も継承されない。dev には置かない（下記）。
- `routes` は書かない。dev は自分の workers.dev ホストだけで動く。本番 URL・アカウント ID・48 桁 path・secret は dev 側に写さない。
- 本番の設定値は変えていない。`wrangler` で解決した本番の設定（名前・DO・migrations・ratelimits・assets・vars）を変更の前後で比べ、同一であることを確かめた（変更記録）。wrangler は「トップレベルの vars・ratelimits が env.dev に無い」という警告を出すが、これは意図どおり（本番の値を dev へ写さないため）。

## 実チームの Issue へ書かない仕組み

二重に止める。

1. **資格を渡さない**: dev には GitHub App の ID・installation・鍵が無い。`handleApi` は `github_not_configured`（503）で GitHub を一切呼ばない。ボードは読み込めず、付箋の棚だけが動く。
2. **変数で書き込みを止める**: `GITHUB_WRITES` が置かれていて値が `"enabled"` でなければ、`POST /api/issues/:n` と `/comments` を 403 `github_writes_disabled` で返す。
   - Worker（`worker/index.ts`）は `MUTATIONS` の DO に入れる前に止める。DO の queue・要求記録にも残らない。
   - `server/github.mjs` の `handleApi` も、本文を読む前・GitHub を読む前に止める。GitHub への書き込み（REST の PATCH/POST/DELETE と GraphQL の mutation）は全てこの経路から入るため、DO を経由した要求も同じ判定で閉じる。
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
- **dev で public-temporary は使わない**。付箋とリモート MCP の目的は「誰が書いたか」を区別することで、匿名の主体では検証にならない。誤って `AUTH_MODE=public-temporary` を入れても、dev には `PUBLIC_LIMITER` が無いので `/api/*` は 503 `rate_limit_not_configured` で閉じる（`PUBLIC_PATH` が無ければ全体が 503）。
- Access の許可一覧は本番のメンバーと同じか、その一部にする。dev の付箋はチームの外に見せない前提で扱う。

## 自動では deploy しない

- CI の deploy job は main への push だけで動き、`wrangler deploy --name ideaboost-whiteboard --keep-vars` と本番の名前を明示している。`--env` を付けないので dev は deploy されない。
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

- `server/github-writes.test.mjs`: `GITHUB_WRITES` の値ごとの判定、停止中は Issue の変更・Status・コメントを GitHub へ 1 件も送らず 403、未設定なら従来どおり書けること。
- `tests/dev-env.test.ts`: `wrangler.jsonc` の `env.dev` が別名・付箋有効・書き込み停止で、GitHub の資格・公開モード・rate limit を持たないこと。本番は付箋無効のまま。dev の Worker は付箋を通し、Issue の変更を DO に入れずに 403。Access 未設定なら全ルート 503、public-temporary にしても API は 503。
- 一度だけの確認（`.validation/` に記録、git に入れない）: `wrangler deploy --dry-run` を本番と `--env dev` で実行し、本番の設定が変更前と同一。ローカルの `wrangler dev --env dev` へ curl で、Access 未設定の全 503、付箋 API の 200、Issue の変更とコメントの 403。
