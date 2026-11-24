# replan — 待ち行列を作り直す

1. `git fetch origin`。docs/ROADMAP.md、`gh issue list --state open -L 100`、`git log --oneline origin/main..origin/develop`、直近の Release を読む
2. ROADMAP の現在の版（v2 など）のうち、Issue になっていない・`needs-human` でない・担当セッションが `claimed` していない項目を、1 周で終わる大きさの `loop:finish` Issue に分けて作る（受け入れ条件・リスク段階・P1/P2 を本文とラベルに）。新規は 1 回 5 件まで
3. `blocked` は理由を読み、(a) 小さく分け直す、(b) 前提 Issue を先に立てる、(c) R3 なら `needs-human` に回す、のどれか
4. 3 時間以上コメントの無い `claimed` は claim を外してコメントする
5. ROADMAP は項目の追加・分割だけしてよい（範囲を狭める・消すのは人）。変えたら `Loop: replan` で develop へ push
6. 公開リポジトリなので Issue に本番 URL・実チームの Issue 本文・個人情報を書かない
7. 最後に `orca worktree set --worktree active --comment "<作った/直した件数>"`
