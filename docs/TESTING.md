# 検証

## 自動試験

`npm run check`: ESLint、Worker TypeScript、Node unit/integration mock、Wrangler dry-run。

`npm run test:e2e`: Chromium実ブラウザー、1920×1080と2560×1440。合成7 PBIを使い最初の6 PBI、1行17 tasks、初期位置で最大96枚を同時表示。5枚目以降のDOMはセル内scrollで続けて読む。

- ページ縦スクロールなし、各セル先頭4枚の矩形がscrollport内に完全包含、続きの範囲/総数、完全行のタイトル。
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

CIの媒体回帰は、ライブ面から読み取り面へ明示切替した際に画像要求が各面で1回（合計1〜2回）となるタイミングを許容する。当時の契約では動画は操作前0件を維持し（現在は下記自動previewへ変更）、遅い画像が本文を妨げないこととclose cleanupを検証する。

媒体追加回帰: 両解像度で同じコメント本文/作者変更後もvideo DOMを保持、本文URL変更・削除で旧video停止、14遅延画像の同時要求上限3とdialog共有observer、閉じる際の待機要求破棄を検証する。当時の再生前通信ゼロ（現在は近傍previewを許可）、悪意Markdown、scope非公開化、IME/source/undo、投稿receipt/結果不明も全体試験に含める。実添付は読み取りのみであり、実IssueへのQA書き込みは行わない。

閉じるアニメーション境界: live媒体6画像の3件を保留し、閉じる承認直後・160ms破棄前にactive画像のloadを合成する。改善前は両サイズで待機1件へsrc設定、追補後は0。closing/非open dialogではqueueを取消し、接続が残るlive widgetでも新規取得しない。実ネットワーク完了を保証するテストではなく、完了イベントの競合順を決定的に検証する。

## 自動preview・作者・選択UI・図・88%詳細

68 backend（36 server + 32 worker）と138 browser（69ケース×両解像度）がローカルで成功。near画像自動表示、未知添付の画像→paused video、動画preview同時1件、画面外未取得、手動再生後の遅延metadata/timeout競合、close取消を検証。作者と担当者の区別、Bot/null、候補外担当者・再open後の選択、Status固有色と列代表色、色変更時snapshot無効化、0/1/6/多数タスク進捗、88%幅、書式ツールバー非表示を確認。

Peleのflowchart/sequence、近傍でのみworker取得、原文CRLF保持、zoom/fit、危険な画像/リンクから外部要求なし、3秒worker終了とsource fallbackを試験。既存IME・undo・同期/保存/コメントの安全性も全回帰に含む。OSネイティブIMEやすべての動画codecの保証ではない。

動画はユーザーの最新指示により『クリック前通信ゼロ』から『近傍で限定preview取得、自動再生なし』へ変更。preloadは転送量の上限ではない。実公開添付の読み取り測定と合成scheduler試験を区別し、実Issue/コメントへのQA書き込みは行わない。

## 青基調・図スクロール・Demo goal追補

69 backend（DESIGN/CSS token一致試験を含む）、146 browser成功。図のFit/拡大中央/境界で実mouse.wheel（斜め含む）を送り、live/read両面で親のscrollが変化し図の位置・scaleは不変、明示drag/±/Fitは動作する。wheel listenerは追加しない。進捗0/1/6/40/41と全完了、blue accentとStatus greenの分離、contrast、長文goalの整数行viewport・末尾scroll、作者同一/変更時のDOM再利用を確認。

同じ作者のfresh read3回は変更前3回DOM置換→変更後0回。変更した作者は即反映。これはfixtureのDOM削減であり、本番レイテンシ短縮率ではない。原文/保存/コメント/媒体/IME/右88%を含む全回帰も実行。

限定レビュー追補: toolbar/detailの入力境界をcomputed styleで確認し、titleは三辺透明＋下線の意図した形を保って下線をinput-borderへ。GitHub avatar取得をabortし、fallback背景selected/文字inkを確認。既存146ケース成功後、追加2ケース（両サイズ）も成功。全148ケースをCI対象にする。

最終配信SHA ca687e7 のCI40326588045で、追加分を含む全148 browserケースと69 backendが成功。本番の入力境界/画像失敗fallbackも両サイズで一致した。

### Statusラベルとflat進捗

詳細のstatus-chipと列見出しの輪郭/内側/文字/角丸の一致、canonical option色の更新と未知色neutral fallback、固定ヘッダー高を両サイズで確認。進捗は0/1/6/40/41件・全完了について件数/要素数、8px・padding0・shadowなし・外端丸・内部直線を検証。読み取り検証のみ、実IssueへのQA書込みなし。

正常な同期/保存済みはhiddenでlive通知しない。POSTをgateした合成試験で、送信本文と後続入力を分離し、後続本文・Status変更・dirty-close警告を保持、重複POSTなしを確認する。担当者checkは全6候補の矩形がtile/scroll領域内に収まりSpaceで選択解除/再選択可能であることを両サイズで検証。

関連PRは正式relationのみ・固定repo/public・全状態・50件cursor・unsafeURL・遅延切替・非公開で消去を確認。OcticonsのviewBox/filled path、MacとWindows keycapsの22px同寸、refresh中の16px維持を確認。detailsはcomplete source範囲、CRLF/コードフェンス/不正終端/ネスト過多、展開前の媒体0、展開後Markdown/Mermaid、malicious属性/HTML、close cleanupを検証。ライブラリは非DOM parse5を使い、構造解析で外部通信しない。

### ライブ一本化・リンク・即時tooltip追補

- 表示モード切替は通常UIから除去。原文はその他メニュー/F8のみ。共有preview rendererはコメント/折り畳みのため保持し、その安全性のbrowser試験はtest-only harnessで呼び出す。製品へ読み取り切替を戻さない。
- Cmd/Ctrlリンク、通常クリック編集、noopener/noreferrer、参照リンク、危険URL/code除外、原文不変。
- tooltipは即時hover/focus・hover保持・Escape・modal内viewport包含・native titleなし。F8はIME中無効。
- 3000層divのdetails/summaryを単体・browserで安全fallback確認。ネイティブ日本語IME実機は未検証で、composition合成試験と区別。

### セル内の続き・PBI担当者・夜間性能

`cell-viewport.spec.ts` は0/1/4/5/9/20件の実矩形、詳細復帰/同期/resize/filter/anchor削除、実wheel・5枚目drag・同列/別PBI境界、drag auto-scroll取消を検証。PBI正本担当の独立表示、複数/未割当/長い名前/画像失敗も両解像度で確認する。DOM全件数と画面内枚数を区別し、toBeVisibleだけでviewport内と判断しない。測定条件とbefore/afterはOVERNIGHT-2026-10-27.md。

## 2026-10-27 離散項目の自動保存

担当者・Status・Story pointsを選択すると200msのローカル集約後、その項目だけを送信する。本文・タイトルは明示保存。CodeMirror/IMEの部分入力やコメントは自動送信しない。同Issueの1 flight中は最後の選択を保持し、先行成功のrevisionで次の要求を送る。元の値へ戻す選択も、送信済み変更に対しては後続の意図として扱う。未送信で元へ戻した場合はPOSTしない。

`autosave.spec.ts`で、未保存本文/titleの便乗送信・ack上書き防止、担当者名保持、閉じる/再訪、完了送信後のStatus変更（reopenなし）、SPの先行応答欠落時expected値保持、競合・unknown時の後続停止を検証する。本文保存中の離散選択も順番を守り、本文の追加draftは保持する。サーバーの競合検査・DO・未知結果停止は変更していない。

ローカルfixtureでは4回の連続選択が1 POST、元へ戻す4回は0 POST。確認完了まで約357–360ms（200msの集約を含む、ネットワーク即時fixture）で、GitHub本番保存時間の改善率ではない。連続保存の途中でwhole-board GETを行わず、最後の成功後に1回更新する。通常状態のラベルは追加しない。

採用PBIへの見積値設定はユーザー依頼による実データ操作として別管理。#631=5、#542=5、#737=8、#692=5、#749=13を未設定確認後にfield49067031だけ設定し、GitHub REST正規値と本番ボード双方で読戻し済み。UX回帰QAでは実Issueを書き換えない。

配信前レビューの再訪回帰: `未整理→レビュー中(送信保留)→作業中(後続選択)→閉じる→再訪` で、fillDetailのupdateDirtyが保持中viewDraftをcanonical値へ上書きすることをfixtureで再現。初期化中はjob draftへ書き込まない境界を設け、3値が異なるケースの再訪前後と最終POSTを両画面で確認する。初期値へ戻す従来ケースだけではこの不具合を検出できないため、両ケースを残す。

配信前レビューの破棄回帰: 本文/titleを明示送信後に追記し、離散選択も追加して閉じる際に破棄を承認、送信が失敗すると追記まで復元されることを再現。close時の復元内容は各fieldで「queued値→送信snapshot→元baseline」の優先順に確定する。送信済み原文と未送信の離散選択は保持し、承認して破棄した追加本文/titleは復活させない。unknown fenceと後続停止も同fixtureで確認。

### Story points の投影とヘルプ（2026-10-27）

- 異なる値の6PBIで1件保存後のboard応答を受けても他5件を保持する。確認済み45秒以内の同集合では保存後の追加SP一括GETは0（従来1）。
- 先行SP GETの対象Aだけ保存ack後の古値を拒否し、同batchのBの更新は採用。空projectionはfield公開失効として全消去。null/キー欠落/失敗は完了時点で空欄へ戻す。
- 待機中は値を維持し、重なるpollは同一flightを利用。通常のfocus/pollで再検証。失敗保存、解除、未設定、未知値、公開scope失効と既存autosave queueを回帰試験。
- ヘルプは3見出しと短い対応表。最大6件/F/Escapeの説明を省略し、既存shortcutは維持。1920/2560の画素・高さ・Escape/focus復帰を確認する。

Project同梱SP: PVTF→canonical IFN ID/type/ALL、通常Project独自numberの拒否、nullと欠落、開始/終了private、GraphQL任意field error時base query、shared reader公開失効を検証。browserではboard応答と同時の数字表示、追加SP endpoint 0、refreshでnull/空へ置換、SP autosaveに未保存本文を便乗させないことを確認。実値QA書込みなし。

### 見積時間・バーンダウン

`server/estimate-hours.test.mjs`は公開canonical field/未取得とnull/単一field保存/解除/種類なし・未知種類/末端集計/階層欠落を確認。`tests/burndown.test.ts`はJST日次、immutable観測、singleflight、失効purge、記録上限を確認。`tests/browser/burndown.spec.ts`は両解像度で遅延load、edge/ボタン/Escape、drawer非発火、本文を巻き込まないautosave、連続変更/再訪、公開失効後ackを確認。実Issue値のQA変更は禁止。
