# 本番配信記録 — 2026-10-26

- Source code commit: `5cf69633dda4f9934a9f50e44149c4ead57436f9`
- CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40268427116 （success）
- Worker: `ideaboost-whiteboard`
- Cloudflare account: `junhat6@gmail.com` / `29a0469ba7d11f29ac94e3ed41f388a8`
- Plan: Free。アップグレード・有料契約変更なし。
- Host: `https://ideaboost-whiteboard.ideaboost-whiteboard.workers.dev`
- Active version: `1716b698-4996-4177-aed0-4a7617a00e67` （PBI完全行の端数ピクセル修正を反映）
- Access: `public-temporary`。ランダム24byte由来の48hexパス配下で匿名閲覧・編集。パスそのものはこの記録に固定せず、配信設定と所有者への報告に保持。
- App ID `5473658`、installation `175301060`。追加本番鍵をserver secretに保存。既存デモ鍵を保持。一時PEM削除済み。App権限・インストール対象の追加なし。
- Source repositoryはprivate。既存Sitesデモと実Issueはテスト目的で変更していない。

## 本番で実施した確認

- TLS成立、正pathのHTML/assets/health=200、health configured=true。
- 実GitHub board=200、14 PBI・24 tasks。repo/Projectのpublic検査を通過。
- 1920×1080と2560×1440のChromiumで6 PBI・15カード。ページ縦スクロールなし、タイトル部分行切れなし、タスク/PBIともタイトル内スクロール0件、アバター8要素。
- 各サイズで2回のIssue編集→キャンセル、PBI drawer、Fullscreen API、ボードクリックによるツールバー閉鎖。JS page errorなし。
- ブラウザーQAは全POSTを遮断し、実際のPOST要求0件。
- 別途パス外404、別Origin POST403、未知フィールドを持つ不正payload400。最後のpayloadは共通validateMutationでintent/GitHub呼出し前に拒否されることをコード・回帰試験で確認した非破壊試験。
- 可視中の自動更新による追加board取得200を確認。
- 実Durable Objectで、正本と異なる既知の古いrevision（1970年）を指定した要求は409 conflict。同じrequest IDは409 request_already_processed。送信したタイトルは現状と同一で、GitHub mutation前のrevision検査で拒否される非破壊検証。
- 本番secret名登録の成功と、配信versionをWranglerで確認。秘密値の出力なし。

## ローカル・CIの確認

lint/typecheck、GitHub mock19件、JWT/route5件、共有coordinator8件、公開境界3件、Chromium36件、Wrangler build。Google DESIGN.md lintエラー0・未参照token警告17。別Worker同時保存、未知結果の永続停止、無効要求10,001件でledger消費0を含む。

## 未実施・制約

実Issueの成功する変更はQAでは実行していない。保存の成功/競合/部分反映はmock試験であり、本番書込成功とは報告しない。GitHub直接編集との競合窓、Issue/Project更新の非原子性、結果不明時の管理者保守、近似的なlocation単位rate limitはADR/OPERATIONS記載通り。

この文書は配信後の記録であり、文書を追加したcommitと上記の実配信source commitは区別する。

## 表示速度・左側Issue画面の更新

- 配信source commit: `4e3c623a05991d698d98d5307969a5d5312eea43`
- Worker version: `1ab6229d-4a3d-46ae-a330-fafda2d246a3`
- CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40274970760 （success）
- 初期表示は同条件3回平均9.350→6.357秒（32%短縮）、API8.840→5.972秒。初回/再訪・測定限界と内訳は[PERFORMANCE.md](PERFORMANCE.md)。古いboardキャッシュは未導入。
- 実背景更新中も取得済みIssueは約30msで開閉可能。左80vwを使用し、編集/保存操作を上部へ移動。確認中は編集を無効化し状態を明示。
- 38件backend、40件browser、lint/typecheck/build成功。実配信の1920/2560で6PBI/15cards、完全行、ページ縦スクロールなし、繰り返し編集キャンセル、PBI表示、Fullscreenを再確認。全QA POSTを遮断し実書込0件。
- 公開mode、host/path/Origin/visibility/rate制約、DO mutation、Free planと鍵は変更なし。

## 再改善版（右80%・初期スケルトン）

- 配信source: `c4ec0332a56a1fa492de68329c607baa691208b8`
- Active Worker version: `97250b6f-5274-4d1f-b38d-e683d8599c0f`
- CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40277772950 （success）
- 初回表示3回平均4.241秒（前回6.357秒、最初9.350秒）。スケルトン251–268ms。測定条件・制約はPERFORMANCE.md。
- 右80%のIssue画面、背景更新中の即時開閉、初期/背景同期/失敗/空状態の区別、再試行、reduced-motionを両解像度で確認。
- 43件backend、48件browser、lint/typecheck/build成功。Google DESIGN.md lintはエラー0、未参照token警告17。
- 実GitHub読取は15 PBI/26 tasks。表示6PBI/15cards、タイトル内スクロール0、ページ縦スクロールなし。実IssueのQA書き込み0件。秘密・認可・公開mode・料金設定の変更なし。

## 自動同期補強版

- 配信source: `77814cfe210f9bf7ccf8f8442af80e4fb23c5a5c`
- Active Worker version: `23e57e52-f1c3-474c-b274-c43bb4a08ca5`
- CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40282711876 （success）
- 43件backend、64件browser、lint/typecheck/build成功。DESIGN.md lintはエラー0、未参照token警告17。
- 表示中45秒・focus・onlineで取得し、操作中に保留した同期は終了後に再開。開いた詳細/一覧/担当者候補の追従と初回エラー復帰を追加。
- 本番の自然な定期取得46.094秒と実offline/online復帰を確認。実Issue変更の伝播はmockで検証し、本番QA書き込みは0件。
- 追加のPBI問い合わせ統合は実測で改善しなかったため撤回。health/board並列化は維持。今回の追加短縮は確認できず、最終新規3回平均表示5.313秒。全測定値と制約はPERFORMANCE.md。
- 両解像度で6PBI/14cards、ページスクロール・半端な行・JavaScriptエラーなし。1920では4タイトルに完全行スクロールの既存フォールバックが作動、2560では0件。詳細はPERFORMANCE.md。
- 秘密・認証mode・公開範囲・料金・GitHub App設定の変更なし。既存デモも変更なし。

最終CIでは43件backend・64件browserを通過。前段のrun 40282197854はwideのスケルトンCSS測定が再描画と競合して失敗したため、現在の要素を再評価する`toHaveCSS`へ修正した。最終配信後にもGitHub取得HTTP200（15 PBI/26 tasks）を確認。この記録修正はドキュメントのみで、配信sourceとは別commit。

## 共有読み取り版（3.5秒目標への改善）

- 配信source: `e146974bb5cd46443e51f267db413c5d3bb357c3`
- Active Worker version: `207d947a-5b55-44fe-beab-f8b39a7cc8e4`
- CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40285023335 （success、53 backend / 68 browser）
- 新規client＋warm共有readerの実カード表示3回中央値2.049秒、範囲1.979–2.087秒。同client再訪中央値1.680秒。共有結果を使わないfresh path中央値3.995秒は未達。完全なfresh完了は別記し、冷えたサーバーの初回まで目標達成とは主張しない。
- 初期共有結果は60秒以内のメモリーのみ。公開/view/Statusは毎回前後確認し、元の取得時刻・年齢と最新確認中を表示。直後のfresh取得完了まで編集/dragを無効化。永続board/CDN/browser cache、Webhook、鍵、namespace、有料契約は追加なし。
- 1920/2560実配信で右80%（x384/幅1536、x512/幅2048）、完全な本文、最新取得後の編集解除、編集キャンセル2回、全画面、6PBI/14cardsを確認。1920の4タイトルは既存完全行スクロール、2560は0件。ページ縦スクロール・半端な行・JavaScriptエラーなし。実IssueのQA POST0。
- 45秒/focus/online同期・dirty draft保護・再接続の回帰試験を維持。計測全値・条件と残るcold課題はPERFORMANCE.md、境界はADR004。

## 共有readerのメタデータ変更競合修正

- 配信source: `0e9dcac6909383607535bbf698195c1dde021b26`
- Active Worker version: `ed51d7d4-7d91-4385-ab80-5f1d941616d7`
- CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40286431384 （success、55 backend / 68 browser）
- view/Statusの変更検出時にepochだけでなく進行中readの共有参照も破棄し、古い定義で開始したreadへ新要求が再参加しないように修正。2つのgated回帰は修正前失敗・修正後成功。旧readの遅い完了が新read参照・snapshotを壊さないことを検証。
- 本番fresh/snapshot GET200、元fetchedAtとscopeの一致、未知query400・root404を確認。実Issue・Project設定のQA変更は行っていない。UI・通常の性能経路は変更しておらず、全速度計測の再実施はしていない。

## 即時Markdown編集版

- 配信source: `813e7e011aafded1bf28bcab55073ec3fcb58cd5`
- Active Worker version: `dc3e11e7-a6fc-4bed-9bff-342ae1d44bdd`
- CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40294963588
- ローカル `npm run check`（55 backend、lint/typecheck/build）と86 browser成功。DESIGN validatorはerrors 0（既存orphan-token warnings 17）。bundle未生成からpredev/predeployによる再生成とdry-runも確認。
- 右80%を維持し、即時入力・CodeMirror 6のMarkdown装飾・安全な単一プレビュー・タイトルリンク・小さなタイトル変更操作へ。常設の編集/最新取得/元IssueボタンとCLOSED/Task/Parent帯を除去。保存は明示操作のまま、fresh照合と狭いpatchを継続。
- 入力中も項目別同期。下書きと同項目への更新は競合選択、別項目は反映。未確定保存は自動再送しない。閉じる承認はアニメーション前に保存前確認を無効化し、遅いbundle到着で入力欄/カーソル/Undoを置換しない。CRLFを含む原文を保持。
- 実配信1920/2560でTask/PBI開閉、即時入力、プレビュー、未保存破棄、右80%を確認。各サイズPOST 0・JS error 0。app.js/editor-bundle.js/styles.css/api-adapter.jsの実HTTP200とローカルSHA256一致を確認。
- 実IssueへのQA保存は未実施。日本語IMEは合成compositionイベントの検証であり、OS実機IMEの完全検証ではない。既存の匿名公開モード・鍵・DO・公開/Origin/rate境界は変更なし。エディターは遅延ロードし、初回ボード取得・共有snapshot・freshness契約はそのまま。
- 本節は過去の「同期中に編集を無効化」「編集中は同期停止」の記録を置き換える。入力と保存可否を分ける現在の契約はADR005を参照。

## 閉じるアニメーション中の新規保存防止

- 配信source: `601dd7e4c4c4639388180df46c3b517c3da2003b`
- Active Worker version: `de957bc5-1aeb-4671-8ebf-a3699908d3ff`
- CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40296367278
- 保存入口とfresh GET後にdialog open/closing/sessionを検証。閉じる承認でsessionが進んだ後、新しいsubmitが発生しても160msアニメーション中にPOSTしない。
- ローカルcheck（55 backend、lint/typecheck/build）と88 browser成功。既存のGET待ち中の閉じる試験に加えて、承認直後に同一taskからsubmitしPOST 0、再表示後は明示保存できる試験を追加。
