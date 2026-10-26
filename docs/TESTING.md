# 検証

## 自動試験

`npm run check`: ESLint、Worker TypeScript、Node unit/integration mock、Wrangler dry-run。

`npm run test:e2e`: Chromium実ブラウザー、1920×1080と2560×1440。合成7 PBIを使い最初の6 PBI、1行17 tasks、最大96枚を同時表示。

- ページ縦スクロールなし、セル4枚、overflow件数、完全行のタイトル。
- 選択上限6、キャンセル、検索と取得順。
- 繰り返し編集、canonical refetch、未保存の破棄確認。
- 保存中の閉じる操作と重複保存、部分保存後の再送禁止と回復。
- XSS文字列の非実行とMarkdown原文、コードブロック/コメント除外。
- 更新間隔、保存/picker中の自動更新停止と入力中の差分同期、同列drag/Doing正規Status。
- キーボード、テーマ、Fullscreen API。

認証試験はローカル生成RSA署名を用いてJWT検証そのものを試す。匿名/nonmemberのHTML・assets・API、偽造/期限切れ/別audience、plain header偽装、別host、cross-origin POSTを拒否。

共有coordinatorは2つのWorker handlerと共通mock storage/upstreamで、古い2回目保存の409、再起動・曖昧結果・記録障害後の再送防止を検証。本番DOインスタンスの試験とは区別する。

GitHub transportはmock。ページング、正式parent/descendant、外部親PBI、null/未知Status、最小権限token、入力制限、競合・同秒の内容変更・重複リクエスト・部分保存・タイムアウト・readbackを検証する。

## 実データの扱い

`/tmp/idea-boost-qa/board.json` は過去の読み取りfixture。リポジトリへ含めない。必要なら一時ローカルのブラウザーmockに使用し、データや画像を公開しない。

本番の認証付き読み取り・本番URLでの匿名拒否・実書き込みはデプロイ設定後に別途確認。現時点のローカル試験では確認済みとしない。

## ローカル検証記録 2026-10-26

- lint / typecheck / GitHub mock 19件 / JWT/route認可5件と共有coordinator8件、公開境界3件 / Wrangler dry-run: 合格。
- Chromium E2E: 18シナリオ × 2サイズ = 36件。全画面切替でフォーカスを保持する修正、通信中断時の再送禁止、長いMarkdownフェンスと未閉じコメントの除外を含む。
- 過去の実データfixture（14 PBI・24 tasks）: 最初の6 PBIで15カードを表示。1920幅で最小12px、2560幅で最小14px。両サイズでタイトルスクロール0件、ページ縦スクロールなし。原文タイトルとPBI列・ゴール列をスクリーンショットで目視確認。fixtureと画像はgit対象外。
- Google DESIGN.md lint: エラー0、未参照component-token警告17（本文とCSSで使う色トークンが含まれる）。
- npm audit: 0 vulnerabilities。開発依存のundici/zodは修正版overrideをlockfileで固定。
- 本番URLと匿名リアルタイム読み取り・両サイズUIはDEPLOYMENT.mdの通り確認済み。実Issue書き込みは未実施。

公開mode: 長いpathの配信/API保存、別host/path/Origin拒否、匿名主体の上書き、rate binding欠落/制限、repo/Projectの非公開化をmockで検証。長いPBIの2560幅はみ出しを再現して修正し、両サイズで完全行と進捗の保持を確認。

ローカルworkerd（秘密なし）でも正path HTML/assets/health=200、root=404、cross-origin POST=403、無効payload=400を確認。これはCloudflare本番配信ではない。CIで発見した初期接続エラーのResizeObserverによる上書きを状態保持で修正し、resize回帰を追加。

## 性能・詳細画面の回帰追加

22件GitHub mock + 16件auth/coordinator/public = 38件、20シナリオ×2サイズ = 40件を通過。遅いGETの完了前にTask/PBIを開閉、左80%の実寸、更新中の編集ロック、取得失敗と再試行、背景クリックの破棄確認を追加。索引から選択Issueのみをhydrateし、欠損時はfail closedとする試験を含む。本番の測定結果と実施範囲はPERFORMANCE.mdを参照。

## 右80%・読み込み状態・取得戦略の回帰

27件GitHub mock + 16件auth/coordinator/public = 43件、24シナリオ×2サイズ = 48件。スケルトン6行とページ高さ、7秒の遅延表示、実AbortSignalの期限切れ（試験で期限を短縮）、失敗後のresize/ツールバー再試行、背景同期の失敗通知と再試行を追加。右80%の座標と背景クリックを確認。

PBI起点と全走査の同値性、子・孫の各ページ、元のProject順、対象外/archived/別repositoryの除外、assignee切り捨て拒否を検証。公開→非公開の遷移拒否は両取得戦略で通過。実測値と本番で実施した範囲はPERFORMANCE.md・DEPLOYMENT.md。

## 自動同期と初回問い合わせの追加検証

27件GitHub mock + 16件auth/coordinator/public = 43件、32シナリオ×2サイズ = 64件。PBI先読み統合は性能が悪化したため取り下げ、既存の取得・公開境界試験を維持。

45秒タイマーでtitle/body/assignees/Status、新しい正式子Issue、閉じたPBIの表示範囲変更を反映する試験を追加。担当者filter、overflow/見送り/未分類一覧、開いたreadonly詳細も追従する。初回失敗からonline復帰、複数wake-upの集約、遅いGETの直列化、編集保持とキャンセル直後の保留同期再開、resizeで中断したdragからの再開を確認。テストは制御したmockの上流変更であり、実Issueを書き換えた伝播試験ではない。

自動取得は表示中45秒ごととfocus/online復帰。連続wake-upは最短5秒間隔にまとめる。保存・drag・PBI選択中は一時停止し、保留された確認を操作終了後に再開する。通常の反映待ちは最大約45秒＋GitHub取得時間（上流検索反映遅延は別）。オフライン・非表示・保存中はこの目安を保証しない。Webhook即時通知ではない。

## 共有読み取り結果の回帰

27件GitHub + 26件auth/coordinator/public/shared reader = 53件。共有readerは、cold/fresh、元fetchedAt/age、60秒期限、milestone分離、前後の公開確認、公開→非公開、view/Status変更、同時取得singleflight、保存中・保存をまたいだreadのepoch、古い進行要求への再参加防止、エラー非保持を検証。実GitHub handlerとのscopeメタデータ整合もmockで検証。保存開始通知失敗では操作しない／終了通知失敗で確定した保存成功を失敗へ変えない／不確定結果は再利用を解除しないことを確認。

ブラウザ34シナリオ×2サイズ = 68件。直近結果の実カード表示、元時刻と年齢、即時fresh要求、保存前の正本照合、入力の継続、更新失敗とretry、非公開判明時の表示停止を追加。既存の45秒同期・offline復帰・dirty保持・右80%・全文・競合試験を継続。

共有readerのメタデータ変更競合を追加修正。古いsnapshotと進行中readがある状態でviewまたはStatus定義が変わると、epochとともに進行要求の共有参照も破棄する。2つのgated回帰は修正前に失敗し、修正後に成功。旧readの遅い完了が新readの共有参照を消さず、新snapshotも上書きしないことを確認。backendは27+28=55件。

## ライブIssue編集（ADR005）

55 backend + 88 browser（44シナリオ×1920/2560）。即時Markdown入力、原文とCRLF保持、Undo、安全なGFMプレビュー、タイトルリンク、背景GET中の入力、別項目マージ、同本文の競合選択、二重保存防止、合成IMEイベント、永続未確定fence、保存成功後GET失敗、scope外下書き保持を検証。OS実機IMEは未検証。本番は読み取り・編集取消のみで実Issue保存は行わない。

閉じる承認直後の保存前GET完了でPOSTしないこと、遅いbundle到着時にネイティブ入力のカーソル/Undoを保持することを追加。dev/deployはprehookでeditor bundleを必ず生成する。

閉じる承認後の160msアニメーション中に新しいsubmitが発生してもPOST 0、閉じ直後の再表示・明示保存は正常であることを追加検証。保存入口とfresh GET後の両方でclosing/open/sessionを確認する。

## タイトル・コメント・遅延メディア・type・操作範囲

62 backend + 106 browser（53シナリオ×2サイズ）。コメント専用入力検証/正式Issue範囲/公開前後確認/Origin/同じDO/成功receipt/曖昧結果fence、タイトルEnter/Escape/blur、16px表示、コメント取得遅延中の本文操作・独立下書き・二重投稿防止、合成WebM/GIFの遅延読み込み・unsafe URL/HTML拒否・close cleanup、type変更/Status移動/unknown配色、Fキー入力除外、実header上半分での操作バー検知を確認。実コメント投稿は行わない。

コメント経路でscope_not_publicが判明した場合にも、既表示board/detailを即時停止する回帰を追加。Fの除外はShift/検索/タイトル/本文/コメントも対象。

投稿受付直後の非公開化でも明示scopeコードとambiguousを保持し即時消去する。50件ページ取得中の投稿成功を古いGETで消さない。WorkerからDOへdispatch後の通信例外も結果不明として同じrequestIdを保持する回帰を追加。

## 同一面ライブ編集とコメント専用scope

67 backend（36 server + 31 worker）、114 browser（57シナリオ×2サイズ）。対象Issue所属の全ページ、非archive/固定repo/直接PBI親の範囲、欠落拒否、公開前後、全ボード詳細を取得しない経路を追加。Server-Timingでscope/comments/visibilityを区別する。混在CRLF/LFの未編集部分を保持する原文パッチを単体検証。

ライブ面では選択行だけ記法を見せる、表/コード/添付の同一面表示、原文切替、実キーボード全選択とUndo、無関係な入力でvideo DOMを再利用し追加取得しないことを確認。既存の合成IME・同期中編集・保存競合・コメント成功/不明/非公開・close raceと6行ボードを継続する。

改行を含む範囲の置換→Undo→Redo→Undoで混在CRLF/LF原文へ戻り、本文差分なしの改名保存となる試験を追加。履歴のinvertedEffectsで原文も復元する。操作バーの右端アイコンと常設操作ボタンの非重複も両サイズで検証する。

## ライブ装飾のIMEと原文モード追補

compositionstart直後（本文変更なし）から非選択行の記法も露出し、入力更新中も維持、compositionend後に装飾が戻ることを合成イベントで検証する。CodeMirrorのview.composingが開始時にfalseでも、DOMイベントのセッション状態を正本にする。保存/閉じるがIME中に発火しないこと、本文原文が保持されることも確認。OSネイティブIMEの完全検証ではない。

原文表示中に未編集本文へremote更新が届いても、setState後に表示フラグを再適用し、アイコンのaria-pressedと記法表示が一致することを追加。67 backendと118 browser（59シナリオ×2サイズ）を対象とする。

CIの媒体回帰は、ライブ面から読み取り面へ明示切替した際に画像要求が各面で1回（合計1〜2回）となるタイミングを許容する。動画は操作前0件を維持し、遅い画像が本文を妨げないこととclose cleanupを検証する。


媒体追加回帰: 両解像度で同じコメント本文/作者変更後もvideo DOMを保持、本文URL変更・削除で旧video停止、14遅延画像の同時要求上限3とdialog共有observer、閉じる際の待機要求破棄を検証する。既存の再生前通信ゼロ、悪意Markdown、scope非公開化、IME/source/undo、投稿receipt/結果不明も全体試験に含める。実添付は読み取りのみであり、実IssueへのQA書き込みは行わない。
