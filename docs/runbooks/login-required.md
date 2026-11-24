# 手順書: アプリ全体のログイン必須化（Cloudflare Access）

- 対象 Issue: #10（ログイン必須化）、#8（チーム付箋。リモート MCP の前提）
- 状態: **手順書のみ。まだ何も設定していない。** 外部設定は、この文書をオーナーが確認して承認した後に、人が行う。agent は Cloudflare・GitHub の設定、secret の登録、deploy をしない
- 関連: [../OPERATIONS.md](../OPERATIONS.md)（public-temporary の承認と境界）、[../ACTIONS-DEPLOYMENT.md](../ACTIONS-DEPLOYMENT.md)（CI 配信経路）、[../RELEASE.md](../RELEASE.md)（昇格の流れ）

この文書には、メールアドレス・本番 URL・公開 path・アカウント ID・秘密の値を**書かない**（リポジトリは公開）。値が必要な所は `<…>` で置き、実際の値は Cloudflare と GitHub の設定画面にだけ置く。

## 0. なぜログイン必須にするか（背景）

今の本番は `AUTH_MODE=public-temporary` で動いている。長い秘密の path を知っている人なら誰でも、匿名で実 Issue を閲覧・編集できる（[OPERATIONS.md](../OPERATIONS.md) の承認内容）。このモードには次の限界がある。

- 保存した人を区別できない（全員が `public-anonymous`）。付箋や赤ペンに作者を出せない
- path が漏れたら、それを取り消すまで誰でも書ける
- リモート MCP（#8）を公開すると、手元の AI が誰の代わりに書いているかが分からない

チームモードの Worker 側の検証（`worker/auth.ts` の Access JWT 検証と許可メール一覧、設定が欠けると 503 で止まる fail closed）はすでに実装・単体試験済みである。そのため、ログイン必須化の作業の大部分は外部の設定と、その前に入れる小さなコード変更になる。

## 1. 前提と、明示承認が要る項目

AGENTS.md の「外部認証設定、秘密の移行、権限拡張、有料契約は明示承認が必要」に当たるため、次の項目は**1 つずつオーナーの承認を取ってから**行う。承認の記録は #10 にコメントで残す（値は書かない）。

| # | 項目 | 何をするか | 承認で確かめること |
| --- | --- | --- | --- |
| A1 | Zero Trust 組織とログイン方法 | Zero Trust の組織（team domain）を作る。ログイン方法は **One-time PIN**（メールに届く一回限りのコード）だけにする | team domain 名。外部 IdP（Google など）を足すかどうか（v1 では足さない案） |
| A2 | Access アプリとポリシー | 本番 Worker の workers.dev ホストを Access の背後に置き、許可ポリシー（メンバーのメール）と Service Auth ポリシー（CI 用）を付ける | 許可する人の一覧の正本（下の 6 章）。セッションの長さ |
| A3 | Worker 変数の差し替え | `ACCESS_TEAM_DOMAIN`・`ACCESS_AUD`・`ALLOWED_EMAILS` を入れ、`AUTH_MODE`・`PUBLIC_PATH` を外す | 切り替えの日時と、メンバーへの告知 |
| A4 | CI 用 service token と GitHub secret | Access の service token を 1 本発行し、production environment に secret を 2 つ足す（`CF_ACCESS_CLIENT_ID`・`CF_ACCESS_CLIENT_SECRET` の名前案）。`PRODUCTION_BASE_URL` をルートの URL に更新する | token の有効期限と更新の担当者 |
| A5 | 料金 | Zero Trust の無料枠の人数上限を公式の料金ページで確かめる | 人数が無料枠に収まること。有料契約はしない |

前提:

- A1〜A5 の前に、2 章の「コード変更」が main（本番）に入っていること
- 許可メンバーの一覧の正本（6 章）が決まっていること
- 切り戻し（7 章）をする人と連絡手段が決まっていること

## 2. 順序と、逆順にしたときに壊れるもの

### 正しい順序

```text
(1) コード変更を develop → 昇格 PR → main（本番に配信）
      ├ CI スモークが「旧 path」と「ルート」の両方の PRODUCTION_BASE_URL を受け入れる
      ├ CI スモークが health の accessMode に public-temporary と team の両方を受け入れる
      ├ CI スモークが service token のヘッダーを送れる（secret があるときだけ）
      ├ Worker に service token 用の「読み取り専用」分岐を足す
      └ チームモードで旧 /b/<path>/ をルートへ 308 転送する（移行期間だけ）
(2) Access を設定（A1・A2）、service token を発行して GitHub secret を登録（A4 の前半）
      → この時点ではまだ public-temporary。旧 URL は「ログインした人だけ」開ける
(3) Worker 変数を差し替え（A3）、PRODUCTION_BASE_URL をルートに更新（A4 の後半）
      → チームモード。ルートで開ける。旧 URL は 308 でルートへ
(4) 確認チェックリスト（10 章）
(5) 移行期間の後、旧 path の転送と public-temporary の分岐を消すコード変更（別 Issue）
```

(2) を (3) より先にする理由: Access を先に付けても、アプリは public-temporary のまま旧 URL で動く。その間は「ログインした人だけが、今までどおり旧 URL を使える」という安全な中間状態になる。逆に変数を先に替えると、次の表の 503 や 401 の状態をはさむ。

### 逆順にしたとき

| 誤った順序 | 何が起きるか |
| --- | --- |
| コード変更より先に Access を付ける | `scripts/deployment-check.mjs` の本番スモークが Access のログイン画面に飛ばされて失敗する。main への push のたびに Verify run が赤になる（deploy 自体は済む。スモークは配信後の確認なので、本番は新しい版になったまま赤が残る） |
| コード変更より先に変数を差し替える | `productionBase()` が `/b/<48桁の16進>/` 形式しか受け入れないため、`PRODUCTION_BASE_URL` をルートに変えると **deploy 前の guard で止まり、以後配信できない**。変えなければ、スモークが旧 path を GET して 404、health の `accessMode` も `team` になり失敗する |
| Access より先に変数を差し替える | Access が JWT を付けないため、`authenticate()` がすべての要求を 401（`sign_in_required`）で拒否する。fail closed なので情報は漏れないが、**全員が使えなくなる**。旧 URL も 404 になる |
| `ALLOWED_EMAILS` を入れずに `AUTH_MODE` を外す | `access_not_configured` で全要求が 503。漏えいはないが停止する |
| service token の分岐なしで Service Auth ポリシーだけ付ける | service token の JWT には `email` が無いため、`requiredClaims` の検査で 401 になり、スモークが失敗する |

## 3. Access アプリとポリシーの作り方（A1・A2）

最小構成は「One-time PIN だけ・Access アプリ 1 つ・ポリシー 2 つ」。画面の名前は変わることがあるので、作業の日に Cloudflare の docs で確かめる。

### 3.1 Zero Trust の組織とログイン方法（A1）

1. Cloudflare ダッシュボードで Zero Trust を開き、組織（team domain `<team>.cloudflareaccess.com`）を作る。プランは Free を選び、支払い方法の登録を求められたら止めてオーナーに確認する
2. Settings → Authentication で **One-time PIN** を有効にする。ほかのログイン方法は v1 では足さない

One-time PIN にする理由: どのメールのドメイン（個人・学校）でも同じ手順でログインでき、IdP との連携（OAuth アプリの登録や client secret）が要らない。Google ログインを足すと楽にはなるが、OAuth クライアントの作成と secret が増え、承認が 1 つ増える。

### 3.2 workers.dev ホストを Access の背後に置く（A2）

1. Workers & Pages → 本番 Worker → Settings → Domains & Routes を開く
2. `workers.dev` の行で **Enable Cloudflare Access** を押す（2025-10-03 の changelog「One-click Access for Workers」）。Preview URLs は `preview_urls: false` なので対象外
3. **Manage Cloudflare Access** から、自動で作られた Access アプリを開く
4. アプリの **Application Audience (AUD) Tag** を控える。これを Worker の `ACCESS_AUD` に入れる（3 章では入れない。2 章の (3) で入れる）
5. セッションの長さを決める（例: 24 時間〜1 週間。短いほど退会の反映が早く、長いほどログインの手間が減る）

### 3.3 ポリシー（A2）

| ポリシー | Action | Include | 用途 |
| --- | --- | --- | --- |
| members | Allow | Emails: 許可メンバーのメール（6 章の対応表のすべてのアドレス） | 人のブラウザでのログイン |
| ci-smoke | Service Auth | Service Token: CI 用の token（4 章） | CI の本番スモーク |

- Access の許可一覧と Worker の `ALLOWED_EMAILS` は**同じ集合**にする。Access は入口、Worker は二重の検査（Access の設定を誤って緩めても、Worker が 403 にする）という役割分担
- 「Everyone」や「メールのドメイン全体」を Include にしない。個人のメールのドメインを丸ごと許すと、そのドメインの誰でも入れる

## 4. CI の service token（A4）

### 4.1 なぜ要るか

main への push の Verify run は、配信の後に本番へ読み取りだけの GET を送る（`scripts/deployment-check.mjs` の `smoke` と `current-sprint-smoke`）。Access の背後ではこれがログイン画面に飛ばされる。CI は人としてログインできないので、Access の **service token** を使い、要求に `CF-Access-Client-Id` と `CF-Access-Client-Secret` のヘッダーを付ける。

### 4.2 発行と登録

1. Zero Trust → Access → Service credentials → Service Tokens で token を 1 本作る。有効期限は 1 年以内にし、期限の 1 か月前に更新する担当者を決める
2. 表示された Client ID と Client Secret は**その場で一度だけ**表示される。画面からそのまま GitHub の production environment の secret（`CF_ACCESS_CLIENT_ID`・`CF_ACCESS_CLIENT_SECRET`）に貼る。チャット・ファイル・コマンド引数に出さない
3. 3.3 の ci-smoke ポリシーにこの token を入れる

secret を repository ではなく **production environment** に置く理由: production environment は main だけに許可されている（[ACTIONS-DEPLOYMENT.md](../ACTIONS-DEPLOYMENT.md)）。PR から secret を読めないため、PR のコードが本番に token 付きで要求を送ることを防げる。

### 4.3 service token の JWT に email が無い点への対応（コード変更）

service token で通った要求にも Access は `Cf-Access-Jwt-Assertion` を付けるが、その JWT には `email` が無く、代わりに `common_name`（token の Client ID）が入る。今の `authenticate()` は `requiredClaims: ["sub", "email", "iat", "exp"]` で検証するので 401 になる。2 章 (1) のコード変更で、次の形の分岐を足す（実装は別 Issue・R2。ここでは要件だけ）。

- `email` が無く `common_name` があり、それが Worker 変数（名前案 `ACCESS_SERVICE_TOKEN_CLIENT_ID`）と一致するときだけ、service token の主体として通す
- その主体は **GET だけ**、かつスモークが読む path（`/api/health`、`/api/current-sprint`、`/api/burndown`、静的 asset）だけに限る。POST・会議まとめ・MCP は 403
- 主体の ID は `service:ci-smoke` のような固定値にし、メンバーの ID と混ざらないようにする
- issuer・audience・署名の検証は人と同じにする（service token 用に検証を緩めない）
- 単体試験: service token の JWT で GET が通る／POST が 403／`common_name` 不一致が 403／`email` も `common_name` も無いと 401

読み取り専用に絞る理由: token は CI の secret として長く残る。漏れたときの被害を「本番の読み取り」に限れば、実 Issue の書き換えは起きない。

注意: service token の JWT の `sub` が空文字になるかどうかは、実機の JWT で確かめる（未確認）。空なら `requiredClaims` から `sub` を外すのではなく、service token の分岐でだけ `sub` を要求しない形にする。

### 4.4 CI の変更（コード変更）

- `productionBase()` は移行期間中、旧形式（`/b/<48桁の16進>/`）とルート（`/`）の両方を受け入れる。移行が終わったらルートだけにする
- health の `accessMode` は `public-temporary` と `team` の両方を受け入れる。移行後は `team` だけにする
- `CF_ACCESS_CLIENT_ID`・`CF_ACCESS_CLIENT_SECRET` があればヘッダーに付けて GET する。ログに値を出さない（GitHub の mask に加えて、ヘッダーを console に出さない）
- `redirect: "error"` などで、Access のログイン画面へのリダイレクトを「成功」と取り違えない

## 5. 旧 `/b/<48 桁の16進>/` URL の扱い

メンバーのブックマークや会議資料には旧 URL が残っている。チームモードではアプリはルート（`/`）で動くため、何もしないと旧 URL は 404 になる。

### 案と推奨

| 案 | 内容 | 評価 |
| --- | --- | --- |
| **A. 移行期間だけ 308 で転送する（推奨）** | チームモードで、旧 path 以下への GET をルートの同じ相対位置へ 308 で転送する。移行期間（例: 2 Sprint）の後に転送を消す | ブックマークが切れない。告知を見落とした人も迷わない |
| B. 告知だけ | 切り替えの前に新しい URL を伝え、旧 URL は 404 | コードは最小。告知を見ていない人が「壊れた」と感じる |

推奨は A ＋ 告知（転送があっても、新しい URL へのブックマークの付け直しは告知する）。

### 転送しても安全な理由

- 旧 path は「知っていれば匿名で編集できる」という**能力そのもの**だった。チームモードでは、その能力が消える。旧 path を知っていても、Access のログインと許可一覧を通らない限り、Worker に要求が届かない
- Access はホスト全体を守るので、転送元（旧 path）にも転送先（ルート）にも同じログインが掛かる。転送は認証を迂回する入口にならない
- 転送は GET だけにする。POST は 308 で転送すると本文ごと再送されるため、旧 path への POST は 404 のままにする（保存の自動再送をしない規約）

### 転送の実装の注意（コード変更の要件）

- 旧 path の値は今と同じく Worker 変数で持つ（名前案 `LEGACY_PUBLIC_PATH`）。コード・文書・ログに値を書かない
- 転送先はルートの同じ相対 path に限る。クエリ以外の任意の転送先を受け付けない（open redirect を作らない）
- 移行が終わったら変数を外し、転送のコードも消す（別 Issue）

## 6. 1 人が複数のメールを持つ場合の対応表

個人のメールと学校のメールのように、1 人が複数のアドレスでログインすることがある。One-time PIN では、どちらのアドレスでもログインできるが、Access の JWT の `sub` と `email` はアドレスごとに別人として届く。

### 置き場所と形

| 層 | どこに置くか | 中身 |
| --- | --- | --- |
| 正本 | オーナーが管理するメンバー一覧（Preview 許可メンバーの一覧） | 人ごとの名前と、その人のアドレス全部 |
| Access | 3.3 の members ポリシーの Include | 正本の全アドレス（人の区別は持たない） |
| Worker | Worker の **secret**（名前案 `MEMBER_DIRECTORY`、JSON） | メンバーの固定キー（例 `member-a`）・表示名・アドレスの配列 |

- 表を git・クライアント・ログ・Issue に置かない。Worker の secret にだけ置く
- Worker は届いたアドレスを表で引き、**メンバーの固定キー**を `x-verified-user-id` に入れる。表に無ければ 403（fail closed）。付箋の作者・赤ペンの署名・レート制限の単位は、この固定キーでそろえる
- 表があれば `ALLOWED_EMAILS` は表から導ける。移行中は両方を検査し、両方に入っている人だけを通してもよい（二重管理は移行の間だけ）
- 表の形を検査する単体試験は、合成の値（`member-a` と例示用のドメイン）だけで書く

この表のコード変更（`MEMBER_DIRECTORY`）は、ログイン必須化の必須条件ではない。v1 のログイン必須化は `ALLOWED_EMAILS` だけでも動く。作者の表示が要るチーム付箋（#8）と一緒に入れてもよい。

### 誰が・どの順で更新するか

メンバーの追加・削除・アドレスの変更は、オーナー（または承認を受けた人）が次の順で行う。

1. 正本の一覧を更新する
2. Access の members ポリシーを更新する
3. Worker の secret（`MEMBER_DIRECTORY`、移行中は `ALLOWED_EMAILS` も）を更新する
4. 退会の場合は、Zero Trust の画面でその人のセッションを取り消す（セッションの長さが切れるまで待たない）

追加のときは 1→2→3、削除のときも同じ順でよい。削除で 2 と 3 のどちらかが遅れても、もう片方が拒否する（二重の検査）。

## 7. 切り戻し手順

ログインの不具合でメンバーが使えなくなったときの戻し方。**public-temporary に戻すと、再び「URL を知っている誰でも匿名で編集できる」状態になる**。戻す前に、オーナーがそれを承認すること（OPERATIONS.md の承認と同じ扱い）。旧 path の値を新しい乱数に替えるかどうかも同時に決める。

### 順序

1. **Worker 変数を戻す**: `AUTH_MODE=public-temporary`、`PUBLIC_PATH=<旧 path か新しい乱数の path>` を入れる。`ACCESS_*` と `ALLOWED_EMAILS` は残してよい（public-temporary のときは使われない）
   - 確認: 旧 path で HTML・`/api/health` が 200、`accessMode` が `public-temporary`
2. **CI を戻す**: GitHub の production environment の `PRODUCTION_BASE_URL` を旧 path の URL に戻す。コードは移行期間中は両方を受け入れるので、コードの revert は要らない
   - 確認: 次の main push（または手動の Verify run）で smoke が通る
3. **Access を外す**: Worker の Domains & Routes で Access を無効にする（Access アプリとポリシー・service token は消さずに残す。再挑戦のときに使える）
   - 確認: ログインなしで旧 path が開ける。ルートは 404

この順にする理由: 変数を先に戻せば、Access が付いたままでも「ログインした人が旧 path で使える」中間状態になり、利用者が使えない時間が最短になる。Access を先に外すと、変数を戻すまでの間、チームモードのまま JWT が届かず全員 401 になる。

### やらないこと

- Worker のコードの版を古い版へ rollback しない（[OPERATIONS.md](../OPERATIONS.md): 共有調停のない旧版へ戻すと同時保存の保証が失われる）。切り戻しは変数と Access の設定だけで行う
- service token を消すのは、漏えいが疑われるときだけ（その場合は GitHub secret も同時に消す）

## 8. リモート MCP の認証（#8。有効にするときの追加手順）

Worker 側の `/mcp` は実装済み（[ADR 018](../adr/018-remote-mcp.md)）。本番では `TEAM_NOTES_MCP_ENABLED: "false"` で 404、dev（9 章）では有効。この章は、Access 側の設定と本番で有効にする手順。どれも外部設定・secret・本番の変更なので、agent は行わない。

Worker が既に行っていること（設定は不要）:

- `/mcp` も他の経路と同じく Access の JWT（`Cf-Access-Jwt-Assertion`）と許可一覧で認証する。public-temporary では 404
- `/mcp` だけは POST の Origin 一致を求めない。代わりに `Content-Type: application/json` と MCP の `Accept`（`application/json` と `text/event-stream`）を必須にし、CORS を許可しない。他サイトの Origin が付いていれば 403
- MCP 経由の書き込みは、利用者ごとに `MCP_LIMITER` を通す。binding が無ければ書き込みを閉じる
- 道具は `notes_list`・`note_suggest`・`note_attach`・`note_propose` の 4 つだけ。採否・削除の道具は無い

### 8.1 第一候補: Access の managed OAuth

- ボードと同じ Access アプリで managed OAuth を有効にする。未ログインの MCP クライアントには Access が 401 と `WWW-Authenticate` を返し、OAuth の案内（authorization server metadata）を出す。ログイン後、オリジンにはブラウザと同じ `Cf-Access-Jwt-Assertion` が届くので、Worker の `authenticate()` と許可一覧をそのまま使える
- 手順:
  - 8.1.1 dev の Access アプリ（9.2）で managed OAuth を有効にする（本番では先に試さない）
  - 8.1.2 許可する redirect URI を設定する（claude.ai と claude.com の callback、ChatGPT の 2 形式、ループバックは `allow_any_on_loopback`）
  - 8.1.3 8.3 の未確認事項を dev で確かめる（9.4）
  - 8.1.4 各クライアント（claude.ai・Claude Code・Codex・ChatGPT・Antigravity）から `notes_list` を呼び、`note_propose` で提案付箋を 1 枚出し、画面に出ることを確かめる
  - 8.1.5 本番で有効にする（8.4、承認が要る）

### 8.2 第二候補: Worker で OAuth 認可サーバーを持つ

- `@cloudflare/workers-oauth-provider` で Worker が DCR・CIMD・トークン発行を担い、ログインは Access for SaaS（OIDC）に任せる。8.1 で通らないクライアントがあるときに切り替える
- 代償: コードが大きい（同意画面・トークンの保存・上流との連携）。Access for SaaS の client secret など、新しい secret と承認が要る

### 8.3 未確認事項（実機の Access で確かめるまで決めない）

- managed OAuth が workers.dev のホストで使えるか
- RFC 9728（protected resource metadata）: 未ログインの MCP クライアントへの 401 の `WWW-Authenticate` に `resource_metadata` が入るか。Access が `/.well-known/oauth-protected-resource` を返すか。その `resource` が利用者の入れた URL（`https://<host>/mcp`）と一致するか（claude.ai と ChatGPT が要求する）
  - Access が返す → Worker は何もしない
  - Access が返さない → Worker に `/.well-known/oauth-protected-resource` を足し（MCP のフラグが有効なときだけ開く、ADR 018）、そのパスだけ Access のポリシーで Bypass にする。Bypass の追加は承認が要る
- CIMD（Client ID Metadata Document）に対応するか（docs に記載がない）
- managed OAuth を有効にした後も、ブラウザのログイン（302 でのリダイレクト）が今まで通り動くか
- ChatGPT で書き込みの道具を使えるのは Business / Enterprise / Edu のプランだけという制約が、メンバーのプランで問題になるか
- Antigravity の OAuth 対応（公式 docs とコミュニティの報告が食い違う）

### 8.4 本番で有効にする（承認が要る）

前提: ログイン必須化（1〜7 章）が済み、8.1.4 が dev で通っていること。

1. `wrangler.jsonc` のトップレベルに `MCP_LIMITER`（利用者ごとの上限。dev と同じ 20 回 / 60 秒から始める）を足し、`TEAM_NOTES_ENABLED` と `TEAM_NOTES_MCP_ENABLED` を `"true"` にする PR を出す。本番の dry-run の bindings 表で、増えたのがこの 3 行だけであることを確かめる
2. 本番の Access アプリで managed OAuth を有効にし、8.1.2 と同じ redirect URI を設定する
3. 10 章の「MCP」を確かめる
4. 切り戻し: `TEAM_NOTES_MCP_ENABLED` を `"false"` に戻して deploy すると `/mcp` は 404 に戻る（付箋の棚は残る）

## 9. dev 環境

付箋とリモート MCP を、実際の AI クライアントから試すための別 Worker（`ideaboost-whiteboard-dev`）。設計と理由は [ADR 017](../adr/017-dev-environment.md)。この章は人がやる手順で、agent は deploy・Access・secret の登録をしない。

dev の性質（設定ファイル `wrangler.jsonc` の `env.dev` で固定済み）:

- 本番と別の Worker 名なので、Durable Object（付箋・要求記録）も本番と別。dev で貼った付箋は本番に出ない
- 付箋は有効（`TEAM_NOTES_ENABLED: "true"`）
- GitHub へは書かない（`GITHUB_WRITES: "disabled"`。Issue の変更・コメントは 403）。GitHub App の鍵も無いのでボードは読み込めず、`github_not_configured` が出る。これは仕様
- チームモードのみ。Access の設定が揃うまで、HTML を含む全ルートが 503（`access_not_configured`）。public-temporary は使わない

### 9.0 承認が要る項目

1 章と同じく、次の項目は 1 つずつオーナーの承認を取ってから行い、#8 にコメントで記録する（値は書かない）。

| # | 項目 | 承認で確かめること |
| --- | --- | --- |
| D-A1 | dev Worker の初回 deploy | Cloudflare の同じアカウントに Worker が 1 つ増えること。無料枠に収まること |
| D-A2 | dev の Access アプリとポリシー | 許可する人（本番のメンバーと同じか、その一部） |
| D-A3 | dev の secret 4 つの登録 | 下の 9.3 の一覧 |
| D-A4 | dev での managed OAuth の有効化（8 章を試すとき） | 許可する redirect URI |

GitHub App の鍵を dev に登録しない。dev でボードも読みたくなったら、読み取り専用の別の GitHub App を作る案を別に承認する（ADR 017）。

### 9.1 deploy（D-A1）

1. develop の最新を手元に取り、`npm ci` と `npm run check` を通す
2. 次のコマンドを**そのまま**使う。`--env dev` を落とすと本番へ deploy される（`npm run deploy` は `--env=""` で本番を明示している）

   ```sh
   npx wrangler deploy --env dev --dry-run
   ```

   dry-run は Worker 名を表示しない（wrangler 4.152 で確認）。代わりに bindings の表で見分ける。

   | 行 | dev（進んでよい） | 本番（止める） |
   | --- | --- | --- |
   | Environment Variable | `TEAM_NOTES_ENABLED ("true")`・`TEAM_NOTES_MCP_ENABLED ("true")`・`GITHUB_WRITES ("disabled")` の 3 行だけ | `GITHUB_APP_ID`・`GITHUB_INSTALLATION_ID`・`TEAM_NOTES_ENABLED ("false")`・`TEAM_NOTES_MCP_ENABLED ("false")` |
   | Rate Limit | `MCP_LIMITER` だけ | `PUBLIC_LIMITER` がある |

   表が dev の列と一致したら、同じ `--env dev` で deploy する。

   ```sh
   npx wrangler deploy --env dev
   ```

3. 表示された workers.dev のホストを控える（以下 `<dev host>`）。ホスト名が `ideaboost-whiteboard-dev.` で始まることを確かめる（workers.dev のホスト名は Worker 名から作られるので、本番と取り違えていればここで分かる）。リポジトリ・Issue・チャットに書かない
4. 確認: ログインしていないブラウザで `<dev host>/` を開き、503（`access_not_configured`）が返る。この時点では誰も読めず書けない

`--keep-vars` は付けない。dev の vars は `wrangler.jsonc` が正本で、Access の値は secret として登録する（deploy で消えない）。

### 9.2 Access（D-A2）

3 章と同じ手順を dev の Worker に対して行う。

1. Workers & Pages → `ideaboost-whiteboard-dev` → Settings → Domains & Routes で、`workers.dev` の行の **Enable Cloudflare Access** を押す
2. 自動で作られた Access アプリを開き、AUD タグを控える（9.3 で使う）
3. ポリシーは members（Allow・Emails）だけにする。dev には CI の service token は要らない（CI は dev を deploy もスモークもしない）
4. 「Everyone」やメールのドメイン全体を Include にしない

### 9.3 secret の登録（D-A3）

dev の Worker に 4 つの値を **secret** として入れる。vars にしない理由: `wrangler deploy --env dev` は `wrangler.jsonc` に無い vars を消すが、secret は残る。また、メールの一覧をリポジトリに置かずに済む。

```sh
npx wrangler secret put ACCESS_TEAM_DOMAIN --env dev   # <team>.cloudflareaccess.com
npx wrangler secret put ACCESS_AUD --env dev           # 9.2 で控えた AUD
npx wrangler secret put ALLOWED_EMAILS --env dev       # 9.2 の許可一覧と同じ集合（カンマ区切り）
npx wrangler secret put APP_ORIGIN --env dev           # https://<dev host>（末尾の / なし）
```

- 値はプロンプトに貼り、コマンド引数・シェル履歴・チャットに出さない
- 登録しないもの: `GITHUB_APP_PRIVATE_KEY`・`GITHUB_APP_ID`・`GITHUB_INSTALLATION_ID`・`AUTH_MODE`・`PUBLIC_PATH`・`GITHUB_WRITES`（`wrangler.jsonc` で固定。上書きしない）

確認（結果は #8 にコメント。URL・メールは書かない）。画面ではなく curl で、状態コードと `error` を見る。ログインした状態の要求には `cloudflared access curl` を使う（Access のトークンを付けて送る。`cloudflared` の導入が要る）。

```sh
D=https://<dev host>

# 1. ログインなしでは Access で止まる（アプリの HTML・JSON は返らない）
curl -s -o /dev/null -w '%{http_code}\n' "$D/"                 # 302（Access のログインへ）。401/403 でもよい
curl -s "$D/api/team-notes" | head -c 200                       # アプリの JSON（"ok":…）が返らない

# 2. 許可メンバーとしてログインする（ブラウザが開く）
cloudflared access login "$D"

# 3. チームモード・GitHub 未設定
cloudflared access curl "$D/api/health"        # 200、"accessMode":"team"、"configured":false

# 4. 付箋は有効。ボードは GitHub を読まない（仕様）
cloudflared access curl "$D/api/team-notes"    # 200、"ok":true
cloudflared access curl "$D/api/team-notes" -X POST \
  -H "Origin: $D" -H 'content-type: application/json' \
  -d '{"requestId":"req_devcheck_000001","op":"create","texts":["dev の確認"]}'
                                               # 200、"createdBy" がログインした人の ID（public-anonymous ではない）
cloudflared access curl "$D/api/board"         # 503、"error":"github_not_configured"

# 5. GitHub へは書けない（存在しない番号を使う。どの番号でも DO にも GitHub にも届かない）
cloudflared access curl "$D/api/issues/999999999" -X POST \
  -H "Origin: $D" -H 'content-type: application/json' -d '{}'
                                               # 403、"error":"github_writes_disabled"
cloudflared access curl "$D/api/issues/999999999/comments" -X POST \
  -H "Origin: $D" -H 'content-type: application/json' -d '{}'
                                               # 403、"error":"github_writes_disabled"
```

- [ ] 1〜5 の結果がコメントのとおり
- [ ] 本番の `/api/team-notes` は 404 のまま（付箋は本番に出ない。本番の URL はここに書かない）
- [ ] 確認で貼った付箋は、画面の棚で剥がしてよい（dev のデータなので残っても本番には影響しない）

### 9.4 managed OAuth と MCP の検証（D-A4）

dev では `/mcp` が有効（`TEAM_NOTES_MCP_ENABLED: "true"`、`MCP_LIMITER` は 20 回 / 60 秒）。8.1 の手順を、本番ではなくこの dev の Access アプリで行う。8.3 の未確認事項は dev で確かめてから本番の判断に使う。MCP の道具は付箋（DO）にだけ書き、GitHub へは何も送らない。

managed OAuth を有効にする前に、Access のトークンを付けた要求で `/mcp` を確かめる（9.3 のログインの後）。

```sh
D=https://<dev host>

# 1. 道具の一覧が 4 つ（notes_list・note_suggest・note_attach・note_propose）
cloudflared access curl "$D/mcp" -X POST \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 2. 提案付箋を 1 枚出す（requestId は毎回新しく作る）。画面の「AI の提案（採用待ち）」に出る
cloudflared access curl "$D/mcp" -X POST \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"note_propose","arguments":{"requestId":"req_devcheck_mcp_0001","text":"dev の MCP の確認"}}}'

# 3. 他サイトの Origin・JSON でない本文は拒否される
cloudflared access curl "$D/mcp" -X POST -H 'Origin: https://example.com' \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{}'
                                               # 403、"error":"origin_mismatch"
cloudflared access curl "$D/mcp" -X POST -H 'content-type: text/plain' \
  -H 'accept: application/json, text/event-stream' -d '{}'
                                               # 415、"error":"json_required"
```

- [ ] 1〜3 の結果がコメントのとおり。2 の提案付箋が画面に出て、人が採用・却下できる
- [ ] managed OAuth を有効にした後、8.1.4 の各クライアントから `notes_list` が呼べる。結果と 8.3 の未確認事項の答えを #15 にコメントする（URL・メールは書かない）

### 9.5 切り戻し・片付け

- 一時的に止める: Access のポリシーから全員を外すか、dev の secret `ALLOWED_EMAILS` を削除する（`npx wrangler secret delete ALLOWED_EMAILS --env dev`）。全ルートが 503 に戻る
- 片付ける: `npx wrangler delete --env dev`。dev の Worker と、その Durable Object（dev の付箋）が消える。**`--env dev` を落とすと本番の Worker を消すコマンドになる**。実行前に表示される Worker 名が `ideaboost-whiteboard-dev` であることを確かめる
- dev の Access アプリは、Worker を消した後に Zero Trust → Access → Applications から削除する
- 本番には触らないので、本番の切り戻し（7 章）とは独立している

## 10. 確認チェックリスト

切り替えの後（2 章の (4)）に、人が上から順に確かめる。結果は #10 にコメントで残す（URL・メール・値は書かない）。実 Issue を QA の目的で書き換えない。

### ログイン

- [ ] ログインしていないブラウザ（シークレットウィンドウ）でルートを開くと、Access のログイン画面が出る。アプリの HTML・`/api/*` は返らない
- [ ] 許可メンバーのアドレスで One-time PIN のログインができ、ボードが表示される（6 PBI・カード・原文）
- [ ] 1 人が持つ 2 つ目のアドレスでもログインできる（6 章）
- [ ] 許可されていないアドレスでは Access が拒否する。Access の設定を誤って通ったとしても、Worker が 403（`member_not_allowed`）を返す（単体試験で確認済みの経路）
- [ ] `/api/health` の `accessMode` が `team`
- [ ] 偽の `Cf-Access-Jwt-Assertion` ヘッダーを付けた要求が 401
- [ ] 別 Origin からの POST が 403（`origin_mismatch`）
- [ ] 1920×1080 と 2560×1440 でボードが今までどおり表示される

### CI

- [ ] main への push の Verify run で、deploy の前の guard・`smoke`・`current-sprint-smoke` がすべて成功する
- [ ] service token で POST を送ると 403（読み取り専用の分岐）
- [ ] CI のログに token・URL の値が出ていない

### 旧 URL

- [ ] ログインした状態で旧 `/b/<path>/` を開くと、ルートへ 308 で転送される
- [ ] ログインしていない状態で旧 path を開くと、Access のログイン画面が出る（転送が認証を迂回しない）
- [ ] 旧 path への POST は 404（転送しない）

### MCP（8 章を有効にしたときだけ）

- [ ] 未ログインの MCP クライアントが 401 と OAuth の案内を受け取る
- [ ] ログイン後、許可メンバーとして `notes_list` が呼べる。許可外のアドレスでは 403
- [ ] `note_propose` で出した提案付箋が画面に出て、人だけが採用・却下できる（MCP に採否の道具が無い）
- [ ] ブラウザでのログインが managed OAuth の有効化の前後で変わらない

### 切り戻しの準備

- [ ] 7 章の手順を実行する人と、旧 path の値の保管場所（設定画面のみ）を確認した
