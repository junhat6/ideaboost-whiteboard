# 依存関係の自動更新

読者は依存更新PRのレビュー担当者と、リポジトリ設定を変更する管理者。`renovate.json` を正本とし、本書には採用理由と、有効化に必要なGitHub側の設定を書く。参考にしたのは engineer-first/idea-boost の `renovate.json` と同repoの依存保守文書（#395）。

## 2026-11-25 の変更: 取り込み先は develop

リリース列車方式（[RELEASE.md](RELEASE.md)）への移行で、Renovate の PR は `develop`（`baseBranchPatterns`）へ向く。自動マージは **本番配信ではなくなった**。パッチは develop の `develop-health`（lint・typecheck・unit・build）が成功すれば取り込まれ、本番へは次の `npm run release` で昇格 PR の full CI（browser suite を含む `check`）を通ってから出る。browser でしか分からない退行は昇格 PR で止まり、develop で直してから出す。

以下の表の範囲（どれを自動にするか）は移行前のまま変えていない。以前の「main へのマージ＝本番配信」を前提にした説明は、昇格 PR の `check` に読み替える。

## IdeaBoost本体との違い（移行前の判断）

IdeaBoost本体は「developへの取り込み」と「本番公開」が別で、本番公開前にリリース手順で人が確かめる。移行前のこのリポジトリは **mainへのマージがそのまま本番配信** だった（`ci.yml` の `deploy` job）。自動マージは自動の本番配信と同じ意味を持つため、本体より範囲を狭くした。

| 更新                                           | 扱い                                                                               | 理由                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| npm依存の1.0以上のパッチ                       | 1つのPRにまとめ、mainの必須チェック `check` の成功後にGitHubのauto-mergeで取り込む | 依頼範囲。PRを1本にして通知と確認の手間を減らす                                                                |
| 1.0以上のマイナー                              | 部品ごとのPR。人がマージする                                                       | 本体はリリース前確認があるため自動化したが、ここではマージ＝本番配信で、CIで分からない挙動変更を止める場がない |
| 0.xの更新（esbuild等）                         | 部品ごとのPR。人がマージする                                                       | 0.xはパッチでも破壊的変更を含みうる。判定はlockfileの固定版で行われる                                          |
| メジャー                                       | Dependency Dashboard（Renovateが作るIssue）で承認した時だけPRを作る                | 移行作業を伴う                                                                                                 |
| `overrides`（undici・zod）                     | Dashboardで承認した時だけPRを作る                                                  | 脆弱性対応の固定版。lockfile内の別版と比べてパッチと誤判定されうる                                             |
| GitHub Actions・`engines`・Nodeの版            | 自動マージしない                                                                   | `ci.yml` は配信secretを扱うjobを含む。commit SHA固定のactionはレビューして更新する                             |
| `latest`・`*` 指定（workers-types・design.md） | Renovateは更新しない                                                               | 範囲が最新を指すためPRの対象にならない。lockfileの更新は手動で行う                                             |

npmの新しい版は公開から3日たってから取り込む（`security:minimumReleaseAgeNpm`）。直後の取り下げや乗っ取られた版を避けるため。PRは日本時間9時前に作り、`dependencies` ラベルを付ける。

## Dependabotではなく Renovate を使う理由

決め手は「自動マージ後に本番配信が走るか」。

- Dependabotにはパッチの自動マージ機能がなく、Actions のworkflowから `gh pr merge --auto` を `GITHUB_TOKEN` で呼ぶ形になる。`GITHUB_TOKEN` によるマージは新しいworkflowを起動しないため、mainへの `push` で動く `deploy` jobが走らず、**mainと本番がずれる**。避けるにはPATやGitHub App秘密をrepoへ置く必要があり、秘密の追加になる。
- Mend Renovate はGitHub Appとしてマージするので、通常のpushとして `check` → `deploy` が走る。repoへ秘密を足さない。
- 「1.0以上のパッチだけ・0.xを除く・overridesを除く」という条件を `renovate.json` 1つで表せ、IdeaBoost本体とも設定の読み方を揃えられる。

採らない場合の影響: Dependabotにすると、自動マージした依存がmainにあるのに本番は古いまま、という状態が次の手動push まで続く。

## 安全に自動マージするための前提

Renovateの既定（`platformAutomerge`）はGitHubのauto-mergeを使う。GitHub側で必須チェックを指定しないと、**テストが未完了・失敗でもマージされうる**（[Renovateのautomerge説明](https://docs.renovatebot.com/configuration-options/#automerge)）。このため次の3つが揃うまで、自動マージは有効にならない・してはいけない。

1. mainのbranch protectionまたはrulesetで、PR必須と必須チェック `check` を設定する。`check` は unit と全browser shardの結果を集約し、失敗・cancel・skipを成功扱いしない既存の判定名。管理者もbypassしない設定にする。
2. Mend Renovate の GitHub App を、このリポジトリだけを対象に導入する。秘密情報をrepoへ追加しない。
3. リポジトリ設定の `Allow auto-merge` をONにする。

本体（#1000）と同じく、最初のまとめPRは手動でマージし、CI失敗・古いheadで止まることを確かめてから3をONにする。

## 失敗時

CIが失敗したまとめPRは取り込まれずopenのまま残る。必要な修正をそのブランチへ足すか、mainで先に直す。すぐ直せない部品は `packageRules` で一時的にまとめから外し、外した理由と戻す条件を本書に書く。自動マージ後に本番で問題が出た場合は [ACTIONS-DEPLOYMENT.md](ACTIONS-DEPLOYMENT.md) の「失敗と戻し方」に従い、`automerge` を `false` に戻して原因を調べる。
