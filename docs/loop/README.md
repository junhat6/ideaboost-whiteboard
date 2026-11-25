# 自律開発ループ

2026-11-25 策定。kobe-student-hub の [docs/loop](https://github.com/junhat6/kobe-student-hub/tree/main/docs/loop) を、このリポジトリの規模と本番境界に合わせて小さく取り入れたもの。ブランチとリリースは [../RELEASE.md](../RELEASE.md)、何を作るかは [../ROADMAP.md](../ROADMAP.md)。

AGENTS.md の境界（GitHub 正本・実 Issue をテストで変更しない・秘密を出さない・認証 fail closed・Durable Object 経由の mutation・自動再送しない）は**このループでも一切変えない**。変えるのは「すべての変更に同じ重さの儀式をかける」ことだけ。

### オーナー方針（2026-11-25）

- **本番にどんどん載せる。** 機能フラグで閉じたまま本番に置かない。使える状態で出す。境界（認証・公開範囲）が前提なら、その前提の作業を前倒しで進める。
- **CI はリリース時だけ必須。** develop への push や作業ブランチで CI に止められて開発が止まる形にしない（develop-health は知らせるだけ）。
- **チームの判断を理由に止めない。** 止まるのは権限が無くて進めないときだけ。その場合は止まった場所を `needs-human` Issue に書いて、他を進める。
- ログイン必須化（Cloudflare Access、#10）とリモート MCP の本番開放（#8）は、この方針で承認済み。有料契約だけは引き続き人が決める。

## 取り入れたもの（kobe-student-hub から）

| 取り入れた | 理由 |
| --- | --- |
| 幹は速く、本番は厳しく（列車方式・リリース時だけ full CI） | 並行セッションが push ごとに 20 分の browser suite を待たない。本番には昇格時の `check` を通ったものだけが出る |
| 1 周 1 仕事、状態はファイルと git と Issues に | 会話の記憶に頼らない。周回は Issue・`git log`・ROADMAP から状況を読み直す |
| 待ち行列は GitHub Issues とラベル | 複数セッションが同じファイルを書かずに claim・コメント・close できる |
| リスク段階で検証の重さを変える（下表） | 戻せる変更は速く、境界に触る変更だけ厚く |
| アンドン（mend）: develop-health が赤なら最優先で直す | 壊れた幹に積むと全員の確認が嘘をつく |
| 詰まったら迂回: 3 回失敗で `blocked`、人の判断は `needs-human` に積んで他を進める | 1 件の詰まりでループ全体を止めない |
| precheck で起こす: 仕事が無ければ agent を起動しない | 待ち時間に費用をかけない |
| commit trailer `Loop:` `Risk:` | 別の記録ファイルを作らずに、ループごとの量とリスク配分を `git log` で追える |

**取り入れなかったもの**: polish・patrol・garden ループ（本番は実チームの Issue を匿名で編集できるため、無人の UI 巡回を本番に向けない。ローカル fixture の巡回は v2 以降に必要になったら足す）、completion.json（ROADMAP の版単位で十分な規模）、Claude Code の hook 群（main は GitHub の保護で既に守られている）、release 列車の時刻表（変更があれば毎時発車で足りる）。

## リスク段階

| 段階 | 例 | develop へ push する前 | 本番へ出す前 |
| --- | --- | --- | --- |
| R0 戻せる | 文言・見た目・文書・テスト追加 | `npm run check`、関係する browser spec | 昇格 PR の full CI |
| R1 振る舞い | 画面の導線・ショートカット・表示ロジック | 上記＋`npm run test:e2e`＋1920×1080 / 2560×1440 で自分で操作 | 同上 |
| R2 境界 | 認証・公開範囲・Origin/rate limit・mutation 経路・競合/部分保存・GitHub 書込・DO migration | 上記＋**別 context の独立検証**（同じ周回の中で別の agent に検証させ、結果を Issue か commit に残す。Issue で人を待たない） | 昇格 PR の full CI |
| R3 外部設定 | 秘密の登録・移行、App 権限、認証方式の切替、実チームへの告知 | 権限があれば R2 として自分で進める。権限が無ければ `needs-human` に「どこで・何の権限が無いか」を書き、他の仕事へ移る | 同上 |
| 課金 | 有料契約・有料プランの申込み | 行わない（無料枠の範囲だけ）。`needs-human` | — |

## ループ

| 名前（Orca automation） | 起動 | precheck（`scripts/loop/precheck.mjs`） | 指示書 |
| --- | --- | --- | --- |
| `ibw mend` | 毎時 :10 | develop-health の最新が failure | [prompts/mend.md](prompts/mend.md) |
| `ibw finish` | 30 分ごと | 未着手の `loop:finish` がある・着手中 2 件未満 | [prompts/finish.md](prompts/finish.md) |
| `ibw release` | 毎時 :40 | 未リリースの commit か出しきれていない昇格 PR がある・open な P0 なし・develop-health 非赤・main の配信が実行中でない | [prompts/release.md](prompts/release.md) |
| `ibw replan` | 6 時間ごと | 未着手が 2 件未満、または blocked が 3 件以上 | [prompts/replan.md](prompts/replan.md) |
| `ibw tidy` | 毎時 :50 | 常に見送り（precheck の中で `scripts/loop/prune-worktrees.mjs --apply --precheck` が終わった run の worktree を消す。agent は起きない） | なし |

どれも run ごとに新しい worktree（base `develop`）を作り、指示書を 1 回読んで 1 周だけ回して終わる。指示書を書き換えれば、automation を登録し直さなくても次の周回から反映される。precheck は origin/develop の版を一時ファイルに書き出して実行するので、古い worktree の版に縛られない。

`ibw tidy` が消すのは、automation が作った worktree のうち、run が終わり agent がすべて done になって 60 分たち、未 commit の変更が無く、HEAD が develop に入った（squash マージ済みの PR を含む）ものだけ。確かめられないものは残す。Orca は new-per-run の worktree を run 後も消さないので、これが無いと run のたびに worktree と node_modules がたまる。消す候補の確認だけなら `node scripts/loop/prune-worktrees.mjs`（dry-run）。

## Issue のラベル

| ラベル | 意味 |
| --- | --- |
| `loop:finish` | ループが拾う実装の仕事。本文に受け入れ条件とリスク段階を書く |
| `P0` / `P1` / `P2` | 優先度。P0 は本番で利用者が詰まる・境界の破れ。open な P0 があると列車は止まる |
| `R2` | 境界に触る。同じ周回の中での別 context の独立検証が要る |
| `claimed` | 着手中。コメントに session・worktree・開始時刻 |
| `blocked` | 3 回失敗か前提待ち。理由を 1〜3 行 |
| `needs-human` | 権限が無くて agent が進めない場所（または課金）。本文に「どこで・何の権限が無いか」 |

**このリポジトリは公開。** Issue・commit・Release に本番 URL（48hex path を含む）・実チームの Issue 本文・個人情報・秘密を書かない。

## commit の書き方

```text
ボードの空セルに次の行動を示す

<何を変え、なぜか。2〜5行>

Loop: finish            # finish / mend / release / replan / human
Risk: R0                # R0〜R2
Closes #12
```

## 並行セッションとの付き合い方

- 大きな機能（会議まとめ・チーム付箋）は担当セッションの作業ブランチで進め、develop 向け PR で取り込む。ループはそれらの Issue を `claimed` のまま触らない。
- develop へ push する前に `git fetch && git rebase origin/develop`。force push しない。
- 壊したら自分で直す。15 分で直せなければ自分の commit を revert。
