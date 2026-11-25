# 019: 付箋をボードの上で GitHub Issue にする

2026-11-25。オーナー方針「付箋まわりを最優先で進める。インパクトが一番大きい」を受けて、ROADMAP v3 にあった「付箋の Issue 化」を前倒しした。付箋に貼った一言が実装の仕事になったとき、GitHub の New Issue → テンプレート → 必須欄 → Project への追加 → Status → 親 PBI、と画面を渡り歩く手間を、ボードの上の 1 つの編集画面にまとめる。

## 判断

- **入口**: 未完了の付箋の「Issue に」ボタン（付箋の上で `I`）。全画面の 88% ドロワーではなく、ボードを背後に残す中くらいのダイアログ（`#note-issue-dialog`）にする。理由: 付箋 1 枚から作る短い Issue で、どの PBI の下に置くかをボードを見ながら決めるため。
- **必須項目は idea-boost の Issue Forms と同じ**（`.github/ISSUE_TEMPLATE/01-pbi.yml`・`02-task.yml`、正本は `docs/team/issue-writing.md`）。
  - Task: タイトル・Why（必須）、How・作業完了条件・関連Issue・補足（任意）、親 PBI・Status。
  - PBI: タイトル・ユーザーストーリー・Why（必須）、ユーザーに提供する体験・補足（任意）、Status。PBI には親を付けない。
  - 本文はサーバー（`server/note-issue.mjs`）が欄から組み立てる。PBI は見出しなしの冒頭ストーリー → `## Why` → 任意欄。空の任意欄は見出しごと出さない。理由: 記述ルールの形式検査（Issue Writing の Action）が見る形を、画面の作り方に関わらず 1 か所で守るため。種類に無い欄（Task の story など）が届いたら黙って捨てずに 400。
  - 初期値: タイトルは付箋の本文、補足は人が「残す」にした添付、種類は Task、Status は未整理、親 PBI はなし。親 PBI の候補はボードに表示中の PBI を先に、その他の open な PBI を後に並べる。親なしは「ボードには出ません」と選択肢に書く（ボードは PBI の子だけを描くため）。
  - Milestone と担当者は付けない。Milestone はチームの定期自動割当に任せる（記述ルールのとおり）。担当者は作った後にボードの詳細で選べる。
- **GitHub への書き込み**（`createFromNote`、`server/github.mjs`）:
  1. 公開範囲・Project・Status の選択肢・親が同じリポジトリの PBI かを読む。
  2. `POST /repos/engineer-first/idea-boost/issues` に `type` と `parent_issue_id` を付けて作る。親子は作成と同じ 1 回の書き込みで付くので、親だけ付かない部分保存が減る。
  3. `addProjectV2ItemById` で Project 3 に入れ、`updateProjectV2ItemFieldValue` で Status を付ける。
  4. 書き込みの応答ではなく **GitHub の現在の状態を読み直して**、種類・親・Project・Status を確かめる（`type` は権限が足りないと黙って落ちるため）。
  - 追加の権限は要らない。既存の installation token（`issues: write`・`organization_projects: write`）の範囲。
- **直列化と二重作成の防止**: Worker は `POST /api/team-notes/<付箋 ID>/issue` を、**付箋ごとの MutationCoordinator**（`engineer-first/idea-boost:note-issue:<付箋 ID>`）へ転送する。Issue の変更が Issue ごとの DO を通るのと同じ型（明示 queue・requestId 記録・結果不明の fence）で、作る前の Issue には番号がないので付箋 ID を鍵にした。
  - Issue ができたら（部分保存でも）DO に受領（番号・URL だけ。タイトルなど Issue の内容は残さない、coordinator の不変条件どおり）を残す。部分保存だった要求を同じ requestId で再送すると、部分保存だったこと（`partial: true`）も返す。同じ requestId の再送は受領を返し、別の requestId で押し直しても 409 `note_already_issued` と同じ受領を返す。**1 枚の付箋から Issue は 1 件だけ**。
  - 送信が通信エラー・形の読めない応答・DO への転送失敗なら結果不明（ambiguous）。DO は fence を残し、この付箋からの作成を止める。画面も作成ボタンを無効にし、GitHub で確かめるよう案内する。自動で再送しない。
  - Issue はできたが Project・Status・親・種類のどれかが済んでいなければ、部分保存（`partial_issue`、`failed` に段の名前）として番号を返す。やり直しはせず、画面は済んでいない段を文字で示す。
  - 作る前の既知の失敗（必須欄・親が無い／PBI でない `parent_not_pbi`・親が閉じている `parent_closed`・GitHub の 422 など）は記録を閉じ、直して作り直せる。親は REST で読み、無い番号も理由の分かる 400 にする。
  - 画面の待ち時間は 90 秒（サーバーは GitHub を最大 5 回続けて呼ぶため、付箋の 20 秒より長い）。待ちきれなければ結果不明として扱う。
- **付箋への結び付け**: 画面は Issue の番号を受け取ったら、付箋 DO に人だけの op `issue`（`{ id, number, url }`）を送る。Worker は転送する前に、その付箋の MutationCoordinator の受領（`/internal/note-issued`、外からは届かない内部経路）と番号を照合し、違えば 409 `issue_not_from_note` で止める。任意の番号を結び付けて、その付箋から二度と作れなくすることを防ぐため。付箋に `issue` を付けて済みにし、rev を上げる。URL は `https://github.com/engineer-first/idea-boost/issues/<番号>` と完全一致のものだけ受け付ける。同じ番号の結び付け直しは何も変えず、別の番号は 409。AI（`/mcp`）は結び付けられない（`issue` は AI の op ではない）。`notes_list` は `issue`（番号・URL）を返すので、手元の AI はどの付箋が Issue になったかを読める。
  - 結び付けだけ失敗したら、もう一度「Issue に」を押すと、DO が新しくは作らずに前の受領を返し、同じ Issue を結び付け直す。
- **公開範囲**: public-temporary の間は**匿名で実 Issue を新しく作れる**。これは既存の承認（匿名の閲覧・編集）より一歩広い。オーナー方針（2026-11-25「付箋をそのまま GitHub Issue にできるように」「本番にどんどん載せる」「ログイン必須化は承認済みで前倒し」）を根拠に開けたが、ログイン必須化（#10）が済むまでの間の扱いとしてオーナーへ報告する。代わりに次で抑える。
  - 秘密の path・固定 host・Origin 検査・公開範囲の確認は既存の編集と同じ経路。rate limit は入口の `public-write`（30 回 / 60 秒）に加えて、**作成専用の `NOTE_ISSUE_LIMITER`（5 回 / 60 秒）**で数える。public-temporary では匿名全体を 1 つの key（`public-note-issue`）、チームモードでは利用者ごと。実 Issue はアプリから消せないので、編集よりずっと低くした。この binding が無い構成では作成を 503 で閉じる。
  - 作者は GitHub App になる（既存の編集と同じ）。
  - ログイン必須化の後は、作成は Access を通った利用者だけになる（コードの変更は要らない）。
  - 匿名の作成を止めたいときは、`TEAM_NOTES_ENABLED` を変えずに `NOTE_ISSUE_LIMITER` を外して昇格すれば、作成だけが 503 で閉じる（棚は使える）。
- **止め方**: `TEAM_NOTES_ENABLED` が `"true"` でなければ経路ごと 404。`GITHUB_WRITES` が書き込み停止（dev）なら DO にも GitHub にも届かず 403。
- **画面の規則**: キーボードだけで開く（`I`）・書く・作る（⌘/Ctrl+Enter）・閉じる（Escape）。タイトル欄の Enter では作らない（IME の確定で誤って作らない）。必須欄が空なら送らず、`aria-invalid` と文字で欄を示してその欄へ移る。閉じても書いた内容は付箋ごとにこの画面を開いている間残す（未保存の破棄確認を出さずに済むように、捨てない）。作れたらボードを静かに読み直し、新しい Task が早く見えるようにする。サンプル表示では作らない。入力欄・ラジオ・選択の Enter では作らない（暗黙の送信を止める）。閉じた後や別の付箋を開いている間に結果が返ったら、棚の状態行に付箋の冒頭とともに出す。下書きは付箋への結び付けに成功してから消す（結び付けだけ失敗したときの押し直しで書き直させない）。

## 運用（結果不明の fence）

付箋ごとの MutationCoordinator（`engineer-first/idea-boost:note-issue:<付箋 ID>`）に結果不明の fence が残ると、その付箋からは作れない（既存の Issue ごとの DO と同じく、自動では解けない）。GitHub の Issue 一覧で作られたかを人が確かめ、作られていれば GitHub 上で Project・Status・親を直し、付箋は済みにする。作られていなければ、新しい付箋に貼り直して作る。この場合、DO に受領が無いので、付箋に Issue のリンクは付けられない（済みにはできる）。DO の記録を消す保守はコードの変更（運用者）で行う。

## 採らなかった案

- **Issue の下書きを AI に作らせてから人が確定する**（ROADMAP v3 の当初案）: 先にボードで人が必須欄を書ける形を出し、AI の下書きは後から足せるようにした。今でも手元の AI が `note_attach` で Why の案を添付し、人がそれを補足に引き継げる。
- **付箋 DO が GitHub を呼んで作り、そのまま付箋を済みにする**: 付箋 DO に GitHub の書き込み経路を持ち込むことになり、ADR 016 の「付箋は GitHub に書かない」境界が崩れる。GitHub への書き込みは MutationCoordinator だけに置き、付箋 DO には結果の番号だけを渡す。
- **1 つの DO で全付箋の Issue 化を直列化する**: 結果不明の fence が 1 件起きるとチーム全員の Issue 化が止まる。付箋ごとなら止まるのはその 1 枚だけ。
- **GitHub の New Issue 画面を開くリンクを出すだけ**: 付箋の文を引き継げず、Project・Status・親の手間も残る。
- **Issue 化を AI の MCP 道具にする**: AI は案を付けるだけで、確定は人（ADR 016 M1）。Issue の作成は確定にあたる。

## 検証

- `tests/note-issue.test.ts`: 本文の形と必須欄・種類に無い欄の拒否、種類と親を同時に指定した作成と読み直し、親が PBI でなければ作らない、部分保存は番号と未完了の段を返して 1 回で止まる、結果不明の fence と付箋 1 枚に Issue 1 件、Worker の機能フラグ・書き込み停止・Origin・`public-write` と作成専用の枠（無ければ閉じる）・転送失敗時の結果不明、付箋への結び付け（人だけ・URL の完全一致・別番号は 409・その付箋の受領と同じ番号だけ）、親が無い／閉じている、部分保存の再送で部分保存を落とさない、受領に内容を残さない。
- `tests/browser/note-issue.spec.ts`（1920×1080・2560×1440）: キーボードだけでの作成、ラジオの Enter で作らない、必須欄の表示、親 PBI と Status の送信、PBI への切替でストーリーが必須になる、閉じても下書きが残る、結果不明で再送せず作成を止める、部分保存の表示と結び付け。
- 実 GitHub への書き込みはこの変更では行っていない（AGENTS.md: 実 Issue をテスト目的で変更しない）。本番での初回は、チームが実際に付箋から作る 1 件目で確かめる。
