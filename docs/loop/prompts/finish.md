# finish — 実装ループの 1 周

あなたは ideaboost-whiteboard の builder です。この 1 周で **Issue を 1 件だけ** 閉じて終わります。

## 0. 向きを確かめる
- `git status`（clean でなければ自分の前回の作業か確かめて片付ける）、`git fetch origin && git rebase origin/develop`
- AGENTS.md、docs/loop/README.md（リスク段階）、docs/ROADMAP.md を読む。UI に触るなら DESIGN.md も

## 1. 1 件選ぶ
- `gh issue list --label loop:finish --state open` から、`claimed`・`blocked`・`needs-human` の無いものを P0 → P1 → P2 の順に 1 件
- 選んだら即 `gh issue edit N --add-label claimed` し、「claimed by <automation名 or session> / <worktree> / <時刻>」とコメント
- 該当が無ければ何もせず終わる（replan が補充する）

## 2. 調べてから作る
- 「まだ無い」と決めつけず、`rg` で既存の実装・部品を探してから作る
- 受け入れ条件を満たす最小で完全な実装。押しても何も起きないボタン・空のハンドラ・TODO を残さない
- R2 に触れるなら AGENTS.md の境界と該当 ADR を読み直す。R3 に当たると分かったら `needs-human` を付けて claim を外し、理由を書いて終わる

## 3. backpressure（push 前に自分で回す）
- R0: `npm run check` と関係する browser spec（`npx playwright test <spec>`）
- R1: 上記＋`npm run test:e2e`（全体）。1920×1080 と 2560×1440 で実際に操作して確かめる
- R2: 上記＋Issue に独立検証を依頼するコメントを書き、別 context の検証結果が出るまで Issue を閉じない
- port は worktree ごとに分離済み（`npm run worktree:ports`）。固定 port を書かない
- 実 GitHub への書き込み・本番 deploy を手元から行わない

## 4. 閉じる
- commit 本文に `Loop: finish`・`Risk: R0|R1|R2`・`Closes #N`。`git rebase origin/develop` してから develop へ push（force push しない）
- push 後 develop-health が赤になったら最優先で直す。15 分で直せなければ自分の commit を revert

## 5. 学びと終了
- 次の周回が同じ失敗をしそうなら、この指示書か AGENTS.md に 1 行だけ足す
- 同じ Issue で 3 回失敗したら `blocked` を付け、理由を 1〜3 行書いて claim を外す
- 最後に `orca worktree set --worktree active --comment "<結果1行>"`。2 件目に進まない
