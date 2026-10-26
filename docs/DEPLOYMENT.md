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

## タイトル・コメント・遅延メディア・付箋と操作改善

- 配信source: `8554804b0c258df012c4c7a8a5b2bd61961298f1`（機能追加 `1e30a419` とコメント境界の追補）
- Active Worker version: `dc681180-56c8-4805-858d-9b40f8138ca4`
- CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40302182953
- ローカルcheck成功（62 backend、lint/typecheck/build）、106 browser成功（53シナリオ×1920/2560）。DESIGN.md validatorはerrors 0、warnings 16（未参照token）で、視覚確認は別途実施。
- タイトルはリンク横の鉛筆で同じ位置に入力。Enter/blurはローカル確定、Escapeは改名取消、GitHub反映はIssue全体の保存。本文/previewは16px。コメント閲覧・明示投稿を追加しApp投稿者であることを表示。
- コメントも同じIssue DO、route/body/requestId照合、最小receipt、曖昧結果の停止を適用。DO dispatch後の通信断は結果不明。非公開判明時は既表示・下書き・媒体を即時消去。古いページGETが投稿確認を消さない。
- 画像はviewport付近で遅延取得。動画は再生操作までsrcも通信もなし。実Issue688の既存QuickTime添付を本番Chromiumで再生しreadyState 4、再生時刻の進行、error nullを確認。すべてのcodec/private添付の保証ではなく、元ファイルリンクを常設。
- 本番1920/2560で詳細表示まで51/52ms（既取得boardからクリック→dialog表示、初回board取得時間ではない）。媒体操作前の媒体通信0、本文16px、タイトル取消、F全画面、header上半分hover、Task黄/競合調査青、6点ハンドル非表示を確認。各サイズPOST 0・JS error 0。4配信assetsのHTTP200/SHA256がローカルと一致。
- Task黄/競合調査青/未知neutralの本文コントラストは11.14/8.70/12.06。type cueも併用。PBI左セルの最小表示・全体ドラッグは維持。
- 実Issue823のコメントGETは200、既存1件とauthor/date/link構造を確認。実IssueのQA保存・コメント投稿は未実施。投稿・二重送信・結果不明・非公開遷移はmockで検証。日本語IMEは合成イベントでありOS実機IMEの完全検証ではない。
- 承認済み匿名公開/App bot投稿モードを維持。新しい権限・鍵・有料サービスは追加していない。

## 同一面ライブ編集とコメント高速化

- 配信source: `cbb252c76be35d8332a73e2a3b3d3cc849214fbb`（主実装 `607df1b70a00b93fefc56e7c4d3f0d768f119cdf`、原文履歴と配置追補）
- Active Worker version: `4a84b4b0-45a0-4a4b-8ca0-18bee468e715`
- 配信CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40307132549
- 主実装CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40306183896
- ローカルcheck成功（67 backend、lint/typecheck/build）、114 browser成功。DESIGN validator errors0/warnings16（未参照token）。
- コメントAPIの実測中央値12.35秒→1.42秒、約88.5%短縮。各3回の範囲12.00〜13.80秒→1.26〜1.93秒。権限cacheは追加せず、対象Issueの正式所属と前後公開確認を毎回実施。詳細はPERFORMANCE.md。
- Markdownは既定で同一面ライブ表示。選択した行/表/コード/添付を原文へ戻し、非選択部分は整形する。単なるタブ名の変更ではなく構文木+Decorationを実装。原文とUndo/Redoを保持し、補助の原文/読み取り表示だけアイコンで用意。
- 操作バーは高さ61pxの一行に整理。常設の長い説明はヘルプへ移し、同期/全画面/配色/ヘルプはtooltipとアクセシブル名を持つアイコン。保存・競合・失敗の意味は維持する。
- 最終配信1920/2560で本文55/51ms、コメント1648/1513ms、媒体操作前通信0、POST0・JS error0を確認。4配信assetsのHTTP200/SHA256がローカル一致。実QuickTime再生は主実装の本番ライブ面でreadyState4/error nullを確認し、追補では追加動画取得を省いた。
- コメント投稿/Issue保存の実QA書き込みは行わない。合成IME、制御した競合/結果不明/非公開化を試験。OS実機IME・全codecを保証しない。タスクリストはチェック記号を表示し、変更時は原文編集へ入る。新たな資格情報・権限・有料資源は追加なし。

## IME装飾・原文表示モードの限定追補

- 配信source: `34a0b228c0c5722cc53633754c9296c7765b8f59`
- Active Worker version: `712753db-2e52-49fb-927a-b4505cad71b9`
- 成功CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40309886457 （検証head `38843dae6d10af969edd43609f6a0082c0334aa4`、配信sourceからアプリコード差分なし）
- 初回run `40308752176` は117/118成功。残る画像試験はライブ面と読み取り面の明示切替による1〜2要求を区別するよう修正し、成功runで67 backend・118 browserすべて通過。動画の操作前通信0条件は維持。
- compositionstart/endから独立したセッション状態を持ち、最初の本文変更までview.composingがfalseでも装飾を解除。原文モードはremote body更新によるsetState後も保持する。
- ローカルcheck（67 backend、lint/typecheck/build）と118 browser成功。開始時本文変更なし→合成IME入力→終了、IME中保存/close抑止、原文表示中のremote更新とaria-pressed整合を両サイズで検証。
- 本番1920/2560の合成compositionイベント・原文切替・開閉で原文不変、POST0・JS error0。4配信assetsのHTTP200/SHA256一致。実GitHub書き込み・native OS IME検証は未実施。
- サーバーコメントscope/速度、権限、秘密、媒体取得方式は変更なし。


## 媒体の再利用・遅延取得の追加改善

- 配信source: `f6c0d519b85ec4f0a184d2bd7a3e1b3423731de3`
- Active Worker version: `643e85c1-225a-4c39-9adf-1733db78eab2`
- CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40312803995 （成功、配信sourceと同一head）
- ローカルcheck成功（67 backend、lint/typecheck/build）、124 browser成功。DESIGN validator errors0/warnings16（既存の未参照token）。
- コメントID/本文を照合し、同じ本文の媒体を保持。作者・時刻等だけの変更はheaderだけ更新し、動画を止めない。本文/URL変更・削除・非公開化は破棄する。
- 画像監視は接続後dialog単位で共有。同時画像取得3件、画面近傍200px、45秒応答しない場合は失敗と元リンク。閉じる際の待機要求開始を抑止。動画は操作前srcなしを維持。
- 合成14画像の高速スクロールでは同時要求13→3。実本番の媒体操作前要求は改善前後とも0。本文パネル61–73ms、ライブ面146–842ms（bundle等の変動を含み速度改善とは主張しない）。詳しくはPERFORMANCE.md。
- 両画面の実本番表示を画素確認、POST0・JS error0。app.js / styles.css / editor-bundle.jsのHTTP200とSHA256がローカル一致。実Issue・コメントのQA書き込みなし。認証・権限・秘密・CSP・料金は変更なし。


### 閉じるアニメーション中のlive画像queue追補

- 配信source: `abad24d42e66e95d190c20a63c3e319b775a7a6f`
- Worker version: `eb270948-5b7d-42b5-8287-352e8d1605d0`
- CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40314593105 （成功、配信sourceと同一head）
- 合成ブラウザーで両サイズ再現: 接続済みlive画像6件（active3/waiting3）を閉じ、160ms破棄前にloadイベントを到着させると、旧実装は待機1件へsrcを設定した。追補後は0。queue pumpはclosing/非open dialogの全jobを取消し、初期observeも同条件で開始しない。
- ローカルcheck成功（67 backend、lint/typecheck/build）、126 browser成功。DESIGN validator errors0/warnings16。追補配信の本番両サイズで本文71/75ms、媒体操作前要求0・POST0・JSエラー0、開閉成功。editor-bundle.jsのHTTP200/SHA256一致。
- 本番live添付面853/857msは新しいbundle取得等を含み、速度短縮の証拠ではない。今回の限定修正は破棄中の不要な新規転送を防ぐもので、実Issueの変更・コメント投稿は行っていない。

### 自動previewと詳細の視覚化

- 配信source: `5b509c2d0e280f191be17e8bf5c8d6d4ea3d19af`
- Worker version: `486cb771-5a4f-408e-ab1f-eec9e65e1e4b`
- ローカルcheck: lint/typecheck/build、68 backend成功。browser138成功（両解像度）。DESIGN errors0/warnings16。
- 近傍で画像/paused動画を自動表示、canonical author、avatar担当者タイル、canonical Status enum色と列色、Pele図の遅延Worker、分割進捗、右88%、書式列削除を配信。
- 本番両サイズで実動画の先頭frame・作者・Status色・幅を確認。POST0/JSエラー0。4配信assets（app/style/editor/diagram-worker）のHTTP200とSHA256一致。実公開5図も配信rendererで描画確認。
- 初期本文/媒体計測と転送量の制約はPERFORMANCE.md。未知添付の型判定とnative metadata取得は厳密なbytes上限ではない。実Issue/コメントへのQA変更なし。既存匿名公開モード/資格情報/権限/料金は変更なし。CSPにはローカルrenderer用worker-src selfのみ追加。
- 同一配信SHAのCI成功: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40320639817 。check成功、browser138件成功（Linux上7.8分）。

### 図の自然なscroll・青基調・Demo goal

- 配信source `f6e1f62e51cc04487035f264c0d24de05380efdc`、Worker `f0add312-9484-409f-b75d-d7290639ad6f`。
- ローカルcheck成功（69 backend）、146 browser成功。DESIGN validator errors0/warnings38（CSS/本文から使うsemantic tokenの未参照警告を含む）。CSS/DESIGN色一致を単体試験。
- 図のoverflow hidden/overscroll autoで通常wheelを親へ渡し、±/Fit/明示dragを保持。青進捗・白goal面・6px上下余白・Status輪郭・semantic token統一を配信。作者同一時DOM再作成を抑止。
- 実本番両サイズでwheel親scroll0→220と図位置/scale不変を確認。実データのgoal可視高133→151px/152→216px。実Issue/コメントQA書込みなし。匿名モード/secret/権限/料金/取得鮮度は変更なし。

#### 入力境界・avatar fallbackの限定追補（最終）

- 最終配信source: `ca687e7534a0dc8313736fc8b4c5c4a80247653f`
- Worker version: `7b6141f5-1c1a-45f5-a9b2-13b03cf0be32`
- 同一SHAのCI成功: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40326588045 （69 backend、148 browser、9.1分）。先行f6e1f62のCI40324712286も成功。
- 高詳細度のtoolbar/detail入力にinput-borderを適用。titleの三辺透明/下線形式は保ち、下線を同tokenへ。画像取得失敗時の小avatarはselected背景＋ink文字（12.28:1）。実本番で画像要求をabortした両サイズのcomputed styleとPOST0を確認。styles.cssのHTTP200/SHA256一致。
- DESIGN errors0/warnings39。PBI面は淡青canvas、カードタイトルはinkの実値へ記述を修正。新規の権限・料金・secret変更なし。文書だけの後続commitではアプリを再配信しない。

### GitHub慣例・関連PR・限定details・ライブ一本化

- 先行7項目配信source `eea3bb5af5c84bbe1fba8c8c20d9f407a221de37`、Worker `aca1e08e-6109-4c41-ae7c-44ed5584aea2`。ローカル73 backend/166 browser成功。CI40333320431は通信中断1件のtimeoutで失敗（165成功）であり、成功runとは扱わない。
- 同じ既存GitHub Appの本番GETで、#823→#836 MERGEDをHTTP200/1813ms、#737→関連なしをHTTP200/1348msで確認。PR readの権限拡張・再認可は不要だった。固定repoの公開PRだけを返し、本文のmentionsを正式リンクと推測しない。
- 追補はライブリンクのCmd/Ctrlクリック・開くaffordance、live単一面＋その他/F8原文確認、Floating UIの即時tooltip。深いHTML3000段によるdetails再帰を反復走査/上限で安全fallbackへ変更。
- source/liveは原文文字列と履歴を維持。previewは通常UIから外し、共有rendererの安全試験はtest-only harnessで実施。runtimeの任意HTML許可や権限/secret/課金変更はない。

#### 最終配信・検証結果

- 配信source: `b2aac899568c6c4971e96116be5824a0d7740f3d`
- Worker version: `c8ba3089-7c27-4623-a6a0-e012bbd63cc7`
- 同一SHAのCI成功: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40338098502 （9分37秒）。先行37d406cのCI40337037289も成功。
- ローカルcheck成功: lint/typecheck/build、75 backend。両解像度174 browser成功（58.7秒）。DESIGN validator errors0/warnings39。
- 本番1920×1080/2560×1440で#737のnative details展開/原文不変、#823→#836 merged PR、右88%、8px flat進捗、共通Status chip、作者/担当avatar、即時tooltipを確認。実リンクのCmdクリックとF8往復、原文不変、POST0、JSエラー0。最終の原文メニューは134×48px、トリガー右端と一致し、文字切れなし。
- 5assetsのHTTP200/SHA256一致を確認。最終追補のapp.js/styles.cssも再確認。本文DOM準備は最初のIssue190/194ms、次Issue12/13ms（取得済みboardからのopen、GitHub取得待ちを含まない）。board表示5077/1515msは各1回の観測で、cold/hit混在のため速度改善率を主張しない。
- 本番はread-only QAのみ。実Issue/PR/コメントを書き換えていない。ネイティブ日本語IME実機は未検証、composition合成試験は通過。関連PRは固定repoの公開PRのみ、detailsは限定構文と安全fallback。匿名公開モード・secret・権限・料金は変更なし。リポジトリPRIVATEを再確認。
- この後の記録追補は文書のみであり、アプリ再配信は不要。上記CIは配信sourceに対応する。
