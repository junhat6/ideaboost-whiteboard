# mend — 幹の修理（アンドン）

develop-health が赤です。他のどの仕事よりも先に直します。

1. `git fetch origin && git rebase origin/develop`。`gh run list --workflow develop-health.yml --branch develop -L 3` で失敗 run を特定し、`gh run view <id> --log-failed` を読む
2. 手元で同じ検査（`npm run check` の該当段）を再現する。再現しなければ `gh run rerun <id> --failed` で一時失敗か確かめ、green なら終わる
3. 原因の commit を特定（`git log`、`git bisect` も可）。15 分で直せれば最小の修正、無理なら原因 commit を `git revert` する
4. 手元で `npm run check` を通してから develop へ push。commit 本文に `Loop: mend`・`Risk: R0`。revert した場合は元の Issue を開き直して理由をコメント
5. テストを skip・削除して黙らせない。最後に `orca worktree set --worktree active --comment "<結果1行>"`
