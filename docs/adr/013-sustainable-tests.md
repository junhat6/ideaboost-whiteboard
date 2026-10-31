# 013: 継続価値に基づくテストと一時検証の分離

- 状態: 採用
- 日付: 2026-10-31
- 対象: whiteboard の通常 CI、変更時検証、配信確認

## 背景と観測

利用者は、価値のある回帰だけを継続し、その変更だけに有用な検証は一時ケースとして実施して恒久 suite に残さない方針を依頼した。遅いだけで無価値とは判断しない。

変更前 SHA `ef16a7756bd30885871631e81c210013b5c78da6` の [Actions 41166530560](https://github.com/junhat6/ideaboost-whiteboard/actions/runs/41166530560) 初回 check は 03:57:21–04:53:21 UTC（約 56 分）。18 focused/repeat バッチで 631 passes、その後同じテストを含む full suite 746 passes（04:22:49–04:53:16、約 30.4 分）を実行していた。focused は約 24 分。unit は 408 件で約 13 秒だった。主な確実な無駄は **同じ回帰の重複実行** であり、746 件全部が不要という証拠ではない。

さらに恒久 suite に、旧デザインを再注入した before/after 比較、合否予算のないフレーム時間探索、既に削除済みの比較デモ不在確認、特定 Sprint/締切の本番確認が蓄積していた。

## 判断

### 恒久テストへ入れる条件

変更説明またはテスト名・コメントで次を説明する。機械的な件数・カバレッジ率・テスト階層の割合ノルマは置かない。

1. **利用者の契約と将来の故障**: 何を壊すと誰にどんな損失があるか。単に今回の実装と同じ値であることではない。
2. **固有の検出力**: 既存ケースとの差分。全件実行前に同じケースをもう一度流すことは新しい検出力ではない。
3. **最小の十分な層**: 純粋な順序・日付・集計は unit、API/DO の競合・境界は mock integration、実 DOM・focus・pointer・scroll・IME・rendering の接続は browser。下位層への置換ではその層で検出できない接続故障を明示し、必要な代表 browser workflow を残す。
4. **安定した判定**: 成功/失敗が製品契約に対応し、実装の命名や現在の CSS 値だけに連動しない。外部サービスは通常 suite では制御する。
5. **費用との釣り合い**: 実行時間、維持費、flakiness、失敗の診断しやすさに対する検出価値。遅い重要テストはまず原因・待機・層を改善する。

一件のバグを契機に追加した回帰でも、再発可能なデータ消失・重複送信・権限漏れ等は恒久価値がある。「その変更で追加した」だけを削除理由にしない。恒久仕様の文字 contrast・reduced-motion・キーボード操作・可読性・カードが重ならない条件は visual でも価値がある。旧画面との差分や CSS 宣言の完全コピーとは分ける。

### 一時検証

旧/新デザイン比較、自然時間の性能探索、特定データ移行・Sprint 切替の実データ照合、再現率を調べる repeat は変更時だけ行える。

- `.validation/`（gitignore、通常 testDir 外）または `/tmp` に必要なケースと設定を作る。既存 fixture を使う一時 Playwright config は明示的に指定して実行する。
- 通常 `npm test` / Playwright discovery / CI に追加しない。永続の manual-only suite として歴代の探索を蓄積しない。
- 変更記録に目的、対象 SHA、実行環境、コマンド、結果、反証できた契約、未検証事項を記す。必要な合成画像等は期限付き artifact とし、秘密・実データを保存しない。
- 受け入れ後に一時コードを削除する。後日再利用する必要が生じたら履歴/記録から目的に合うケースを作り直す。
- 一時検証から将来も必要な契約が見つかった場合だけ、上記条件を満たす最小の回帰へ作り直す。

### CI と故障調査

通常 push/PR は `npm run check` と `npm run test:e2e` を各 1 回実行する。full suite 前の同じ focused suite、repeat-each 診断ゲートは置かない。focused 実行は開発中の短い feedback または失敗調査に使う。

1920×1080 / 2560×1440 はカード密度・geometry を含む既存製品契約のため今回維持する。viewport 非依存のケースを減らす場合も、代替の検証と固有の browser リスクを個別に説明する。並列数の増加、retry、sharding だけでテストの過剰を隠さない。今回は workers/retries を変えない。

失敗時だけ合成 `test-results/` を artifact に残す。通常は失敗 screenshot とログ、調査時は `--trace on` を明示する。全件常時 trace による記録負担は追加しない。repeat が必要な race はまず制御可能な network gate/clock で条件を作る。実 rendering の試験を virtual clock の成功だけに置き換えない。

性能は環境・ブラウザ・負荷・サンプル条件と事前の有意味な予算がある場合だけ恒久的な合否に使う。共有 CI の rAF 比較だけで実利用の FPS/体感速度を保証しない。診断値をログに出すだけのテストを毎配信の性能ゲートと呼ばない。

## 今回の棚卸しと残る検証

| 整理対象 | 判断・残る契約 |
| --- | --- |
| CI 18 focused/repeat バッチ | 削除。同じ feature の通常 browser ケースを full suite で 1 回実行。close 遅延 ACK、drag 中断、取消等の機能回帰は残す。 |
| `unestimated-motion.spec.ts` の旧 A/強化 A 比較 | 削除。古い CSS の注入と相対画素強度は一回のデザイン判断。現行 halo の紙面/隣カード非干渉、resize、offscreen/drag/document 非表示の停止再開、reduced-motion は維持。 |
| 同ファイルの 6/24/94 枚 OFF/ON フレーム時間記録 | 削除。性能予算を判定せず探索値を記録していた。対象選別・多数カード・非表示時停止は `unestimated-highlight` と残存 motion ケースで検証。 |
| `highlight-demo-removed.spec.ts` | ファイル削除。廃止済みデモの asset 不在は今回だけの撤去確認。U の初期 OFF・keyboard・通信しない・対象選別は `unestimated-highlight.spec.ts` に残る。 |
| `issue-state-contrast.spec.ts` の exact RGB/font/footer/CSS snapshot | 除去。正本 state と Status の区別、label/aria/icon、合成背景に対する contrast 4.5:1、Close の可否は維持。Close pending/retry/keyboard と contrast は `close-button-design.spec.ts` でも維持。 |
| 固定 Sprint 9/cutoff smoke と Sprint 10 audit、その専用 helper/unit | 削除。`current-sprint-smoke` が正規 current Sprint の number を使って history を GET し shape/有限集計値を確認する汎用 smoke に統合。特定日付・時間数・Sprint の存続を毎配信の条件にしない。 |

auth/public/coordinator、GitHub 取得/保存/手動順とページング、undo、unknown outcome/partial/conflict/retry、Markdown 安全性、背景保存・入力保持等は削除していない。`tests/burndown-rollover.test.ts` の履歴固定、排他的 cutoff、late writes、scope、403/503 の拒否を含む契約も維持する。

### 配信確認の範囲と限界

trusted main/commit、認証、固定 host/path、health、全 asset hash、current Sprint metadata は維持。current Sprint が存在すればその history/DO の通常 GET も実施する。HTTP エラーを retry/旧値で隠さない。current が none/unavailable の正規応答なら history の対象がないことを明示し、履歴確認済みとはしない。

特定の過去 Sprint 9 の本番保存状態を毎配信で実測する保証はなくなる。mock の履歴境界試験は本番 DO の保存証明ではない。履歴ロジック/移行変更時は、必要な過去 Sprint の read-only 一時検証を追加する。これは一時的 503 を無視して CI を緑にする判断ではなく、期限付き検証と恒久契約の分離である。実 Issue/Project をテストのため変更しない。

## 削除・変更時のレビュー

- 契約自体が廃止されたか、残るテストの場所/シナリオで同じ故障を検出するかを示す。
- 代替を実行し、独立の security・data-loss・a11y 条件を捨てていないことをレビューする。
- 失敗を直すためだけの skip、assertion 削除、snapshot 一括更新、全件 retry はしない。
- 変更後の実測時間と環境を記録する。runner/負荷の違う旧新 run から厳密な高速化倍率を主張しない。件数減少を成果そのものにしない。

## 根拠

- [Playwright Best Practices](https://playwright.dev/docs/best-practices): 利用者に見える振る舞い、独立したテスト、実装詳細への過度な依存を避ける。
- [Google Testing Blog: Just Say No to More End-to-End Tests](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html): 小さな試験による速く原因の分かる feedback と、必要な統合 workflow の釣り合い。推奨比率をこの製品のノルマにはしない。
- [Playwright Clock](https://playwright.dev/docs/clock): タイマー条件を制御し、時間経過だけの待機を減らせる。ただし実描画性能の代替にはしない。
- [Playwright CI](https://playwright.dev/docs/ci): CI 安定性と runner 資源に応じて実行方法を決める。並列度だけで最適化しない。
