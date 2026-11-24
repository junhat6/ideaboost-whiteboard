# ブランチとリリース

2026-11-25 策定（v1 リリースと同時）。開発を止めずに回し、本番には full CI を通ったものだけを出すための決まり。ループ（誰が・いつ・何を回すか）は [loop/README.md](loop/README.md)。

## 一言でいうと

**develop は速く、main は厳しく。** develop は全セッションが直接 push する開発の幹。本番へは develop から選んだ 1 つの SHA を `npm run release` で main へ昇格させ、そのときだけ full CI を必須にする。

```text
各セッション ─push─▶ develop ─(npm run release)─▶ rc/<sha7> → main の昇格PR（full CI = check 必須）
                       │                                    │ green なら merge
                       │                                    ▼
                       │                      main push の Verify run: check → auth-check → deploy → smoke
                       │                                    │ 成功
                       │                                    ▼
                       │                      tag vX.Y.Z ＋ GitHub Release → main を develop へ戻す
                       └─ push のたびに develop-health（lint・typecheck・unit・build。必須ではない）。赤なら mend が直す
```

## なぜ main を本番のまま残したか

kobe-student-hub は「main＝幹、release＝本番」にしたが、このリポジトリは逆に **main＝本番、develop＝幹** にした。

- 本番配信の仕組み（`ci.yml` の `deploy` job、production environment の main 限定 branch policy、main の branch protection の必須 `check`、PR 必須・管理者も bypass なし）は、承認を受けて作られ readback 済み（[ACTIONS-DEPLOYMENT.md](ACTIONS-DEPLOYMENT.md)）。これを release ブランチへ移すと environment の branch policy と保護設定を作り直すことになり、AGENTS.md の「外部認証設定・権限拡張は明示承認が必要」に触れる。main を本番のまま残せば、配信経路・秘密・保護は 1 つも変えずに済む。
- 同じ持ち主の engineer-first/idea-boost も develop を幹にしているので、名前の意味が揃う。

採らない場合の影響: release ブランチ方式にすると、production environment の branch policy を main から release へ変える作業（権限境界の変更）と、その readback が v1 の締切前に必要になる。

## ブランチ

| ブランチ | 役割 | 守り |
| --- | --- | --- |
| `develop`（default） | 開発の幹。直接 push してよい。PR は任意 | ruleset で force push・削除を禁止。必須 CI なし |
| `main` | 本番の写し。ここにある＝本番にある | 既存の branch protection：PR 必須・必須チェック `check`（strict）・管理者も bypass なし・force push/削除禁止 |
| `rc/<sha7>` | 昇格 PR の head。`npm run release` が作り、merge 時に消す | なし |
| 作業ブランチ | 衝突しそうな大きな作業だけ。develop 向け PR | なし |

main へは **`npm run release` が作る昇格 PR 以外で入れない**。hotfix も develop で直して昇格させる（main にしか無い commit を作らない）。

## CI

| workflow | いつ | 必須か | 中身 |
| --- | --- | --- | --- |
| `ci.yml`（Verify） | main 向け PR（昇格 PR）、main への push、手動 | **main で必須**（`check`） | lint・typecheck・unit・build・全 browser suite（2 shard）。main push では続けて auth-check → deploy → 本番 smoke |
| `develop-health.yml` | develop への push、develop 向け PR | 必須ではない | `npm run check`（browser なし）。数分で幹の故障を知らせる。Renovate の自動マージ条件にもなる |

develop の push と作業ブランチの PR で full CI を回さない理由: browser suite は 1 回 15〜20 分かかる。並行セッションの push ごとに待つと、開発の速さが CI 待ちで決まる。壊れたものが本番に入らないことは昇格 PR の `check` と main push の `check` で守れる。

## リリースの手順（人でも agent でも同じ）

```sh
npm run release -- --plan                 # 何が昇格するかを見るだけ
npm run release                           # origin/develop の先頭を昇格し、配信・tag まで見届ける
npm run release -- --sha <sha>            # develop 上の特定 SHA を昇格
npm run release -- --version v2.0.0       # tag 名を指定（既定は直近 v* の patch +1）
npm run release -- --continue             # merge 済みの main の配信を見届け直し、成功なら tag
```

`scripts/release.mjs` の順序:

1. SHA が origin/develop の履歴にあり、origin/main を含むこと（main にしか無い commit が無いこと）を確かめる。
2. `rc/<sha7>` を push し、main 向けの昇格 PR を作る（古い rc PR は閉じる。列車は常に 1 本）。
3. PR の `check` を待つ。赤なら **exit 10**。
4. green なら merge（merge commit）。main への push で Verify run が check → auth-check → deploy → smoke を行う。それを見届け、赤なら **exit 11**。
5. 成功したら tag `vX.Y.Z` と GitHub Release（commit 件名の一覧。URL や個人情報は書かない）を作る。
6. main の merge commit を develop へ戻す（fast-forward、develop が進んでいれば merge）。次の昇格 PR が strict の「base が head の祖先」を満たすため。

## CI が赤のとき（リリースは止めずに直しきる）

リリースは始めたら本番に出るまで回しきる。「記録して終わり」にしない。

| 出たもの | やること |
| --- | --- |
| exit 10（昇格 PR の CI 赤） | `gh run view <id> --log-failed` で原因を特定 → develop で最小の修正 → 手元で該当テストを通して push → `npm run release` をやり直す（新しい rc が古い PR を置き換える）。runner 都合の一時失敗と判断したら `gh run rerun <id> --failed` → 同じコマンドで続きから |
| exit 11（main の CI・配信が赤） | 本番は前の版のまま（deploy は check 成功が前提）。一時失敗なら `gh run rerun <id> --failed` → `npm run release -- --continue`。コードの問題なら develop で直して `npm run release` |
| exit 12（前提違反） | 表示どおり。main にしか無い commit があれば develop で `git merge origin/main` して push |
| smoke 失敗 | deploy は済んでいる。[ACTIONS-DEPLOYMENT.md](ACTIONS-DEPLOYMENT.md)「失敗と戻し方」で Version を照合し、必要なら rollback。自動 rollback はしない（既存方針） |

同じ原因で 3 回落ちたら直し方を変える。テストを skip・削除して黙らせない（AGENTS.md・ADR 013）。

## 版の付け方

`vMAJOR.MINOR.PATCH`。MAJOR は [ROADMAP.md](ROADMAP.md) の v1 / v2 / v3 に対応させ、その版の範囲を出しきったときに `--version` で上げる。それ以外の昇格は patch を自動で +1。
