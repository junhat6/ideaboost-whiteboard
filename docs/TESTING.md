# 検証

## 自動試験

`npm run check`: ESLint、Worker TypeScript、Node unit/integration mock、Wrangler dry-run。

`npm run test:e2e`: Chromium実ブラウザー、1920×1080と2560×1440。合成7 PBIを使い最初の6 PBI、1行17 tasks、最大96枚を同時表示。

- ページ縦スクロールなし、セル4枚、overflow件数、完全行のタイトル。
- 選択上限6、キャンセル、検索と取得順。
- 繰り返し編集、canonical refetch、未保存の破棄確認。
- 保存中の閉じる操作と重複保存、部分保存後の再送禁止と回復。
- XSS文字列の非実行とMarkdown原文、コードブロック/コメント除外。
- 更新間隔、編集/picker中の自動更新停止、同列drag/Doing正規Status。
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
- 本番URL/認証付きリアルタイム読み取り/実Issue書き込み: 未実施。

公開mode: 長いpathの配信/API保存、別host/path/Origin拒否、匿名主体の上書き、rate binding欠落/制限、repo/Projectの非公開化をmockで検証。長いPBIの2560幅はみ出しを再現して修正し、両サイズで完全行と進捗の保持を確認。

ローカルworkerd（秘密なし）でも正path HTML/assets/health=200、root=404、cross-origin POST=403、無効payload=400を確認。これはCloudflare本番配信ではない。CIで発見した初期接続エラーのResizeObserverによる上書きを状態保持で修正し、resize回帰を追加。
