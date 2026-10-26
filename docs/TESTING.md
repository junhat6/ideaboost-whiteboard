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

55 backend + 80 browser（40シナリオ×1920/2560）。即時Markdown入力、原文保持、Undo、安全なGFMプレビュー、タイトルリンク、背景GET中の入力、別項目マージ、同本文の競合選択、二重保存防止、合成IMEイベント、永続未確定fence、保存成功後GET失敗、scope外下書き保持を検証。OS実機IMEは未検証。本番は読み取り・編集取消のみで実Issue保存は行わない。
