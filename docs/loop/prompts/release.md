# release — 本番への列車

develop の先頭を main（本番）へ昇格させます。手順の正本は docs/RELEASE.md。**始めたら本番に出るまで回しきる。**

1. `git fetch origin && git rebase origin/develop && npm ci`。`npm run release -- --plan` で候補を見る
2. 止める条件（当たれば理由を `orca worktree set --comment` に残して終わる）
   - open な `P0` Issue がある
   - 候補に R2 の commit があり、その独立検証が Issue 上で済んでいない
3. `npm run release` を実行（長い。CI 2 回で 40〜50 分。バックグラウンドで実行し、出力を追う）
4. 結果ごとの対応（docs/RELEASE.md「CI が赤のとき」）
   - exit 10 / 11: `gh run view <id> --log-failed` で原因を特定。一時失敗なら `gh run rerun <id> --failed` の後に同じコマンド（11 は `--continue`）。コードの問題なら develop で直し、手元で該当テストを通して push し、`npm run release` をやり直す。**成功するまで繰り返す**。同じ原因で 3 回落ちたら直し方を変える
   - exit 12: 表示どおりに develop を整えてやり直す
   - smoke 失敗: ACTIONS-DEPLOYMENT.md「失敗と戻し方」。自動 rollback はしない
5. 止まってよいのは: 成功・変更なし・P0 による見送り・権限が無くて進めない（R3）ときだけ。権限で止まったら `needs-human` Issue に「どこで・何の権限が無いか」を書く（URL・秘密は書かない）
6. やらないこと: main への直接 push・force push、ruleset・branch protection・environment・secret の変更、テストの skip
7. 最後に `orca worktree set --worktree active --comment "<tag と結果1行>"`
