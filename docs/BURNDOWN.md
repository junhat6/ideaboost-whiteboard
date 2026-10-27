# 作業Issue見積時間とバーンダウン

## 正本と対象

- 正本は組織Issue Field `Estimate Hours`（Number / Public）。PBI配下の作業Issueの全体見積時間hであり、実績時間・残作業の自己申告・PBI Story points換算ではない。任意、未設定はnull。0は明示値としてのみ認める。
- 公開fieldのID・型・公開範囲を開始/終了に検証し、Projectの参照field経由で取得する。通常boardの既存作業Issue queryへ同梱し、作業IssueごとのREST waterfallを追加しない。Project外の作業Issueを推定して加えない。
- スプリントは固定repoの正式milestone番号。view 16のPBIと正式子孫のうち、作業Issue自身または所属PBIのmilestoneが一致する対象。作業Issue自身にmilestoneがある場合はそれを優先し、二重計上しない。表示6PBI・担当者・検索filterは集計対象に影響させない。
- `完了`だけを完了として扱う。見送りは取消として区別し、完了成果へ含めない。Issue closed単独は完了とみなさない。

## 観測履歴

- 既存Cloudflare内の専用Durable Objectへ、全ページ取得成功時の観測のみ保存。JST日付、観測時刻、正式scope、作業Issue ID/parent/estimate/null/status/completeを持つ。部分取得・取得不能・非公開化を0件として保存しない。
- 日次alarmで閲覧者不在でも取得。初回有効化より前の履歴は作らず、イベント発生時刻ではなく観測時刻として描く。途中追加・除外・再見積・reopenは新しい観測の差分であり、過去点を再計算しない。
- 閲覧時も最新の公開確認を行う。field/repo/Projectの公開失効時は履歴を公開せず、失効前の値を復活させない（履歴自体は保管し、再公開確認までは返さない）。ネットワーク失敗を正常な空履歴へ変換しない。
- 既存milestoneは期日があるが開始日がない（2026-10-27読み取り確認）。created_atを開始日と誤用しない。開始日・開始baselineが確定するまで理想線を省略し、観測された未完了見積合計だけ表示する。

## 操作と表示

- ボード右端3.5%のhover、明示ボタン、keyboard/touchからoverlayを開く。Issue drawer・drag中は自動表示しない。元boardの幅やscrollを変えず、Escape/backdropで閉じfocusを戻す。
- チャートと履歴通信は初回パネル表示時に遅延load。青ideal・赤actual、見積済hと未見積n件を併記。全未設定を0時間達成に見せない。観測開始前は空白。
- 作業Issue詳細の任意数値入力は0〜1000h、小数可。入力中の空文字や途中の小数点は即送信せず、blur/Enterで確定、解除は明示操作。既存metadata autosaveの単一flight/最新意図/field単位ackと未知結果fenceを使い、本文やtitleを便乗保存しない。
- 実IssueのQA値入力・既存作業Issueの一括見積・既存label移行は行わない。

## 現在の外部設定

2026-10-27、既存ownerの正規画面で作成・同一項目のProject参照を確認。org field `49079931` / `IFN_kgDOAuzmew`、Project field `PVTF_lADOEYcVLM4Bb8yFzhnZdjc`。Number / Public。現存のPBI以外の全種類と種類なしへpin。App権限・既存Issue値は変更していない。

## 種類と階層

種類名の列挙を認可に使わず、固定repo内の正式なPBI祖先を持つ非PBI Issueを編集対象とする（最大8階層）。未知の種類も同じ規則。集計は末端作業のみで、親作業の見積を子と合算しない。子件数差分は正式subIssuesとProject所属を追加照合する。Project外と確認した直接の子は対象外件数として示す。Project内なのに欠落した子や不完全応答は観測を確定せず、取得不能を0件にしない。PBI自身はStory pointsのまま。

## 保管と負荷の上限

- 日次はJST 00:10。配信後の正規readでDOを起動し、その後は閲覧者なしでもalarmで継続。alarm再実行は同日同内容のsignatureで冪等。
- immutableな各観測と、日ごとの最終観測への小さいindexを原子的に保存。チャート読取は最大180日分のindexだけを読み、全作業snapshotを毎回メモリ展開しない。保持180日、1日最大96観測。上限時も現在値は確認するが履歴の制限を表示し、過去点は上書きしない。
- 同時閲覧はsingleflightで共有し、完了後の閲覧は新しい公開確認を行う。TTLで公開確認を省略しない。最大500末端作業・100milestone、完全性を超えた応答は観測不能として扱う。
- 初回boardへ履歴API/チャートimportを加えない。別途数値の初期入力や実Issue QAは行わない。

公開性の確認不能（optional queryのfallback等）は503、一致した正規fieldのORG_ONLY確認は403。いずれも記録を返さず、既存履歴を消去しない。再公開を正規readで確認できた場合のみ保管済み履歴を再び閲覧可能にする。

実データのread-only照合でSprint 9のPBI #132にProject外の子 #226があることを確認した。対象は既存boardと同じProject 3内の末端作業。件数差分がある親だけ正式な直接の子・全Project所属を読み、Project外/対象外を明示する。初回boardにはこの履歴用追加queryを入れない。実Issueを勝手にProjectへ追加せず、Project内の読取欠落は引き続き拒否する。

Project外の直接子を除外できるのは、正式な子件数が0の末端と確認できた場合だけ。中間作業または子件数不明は、その先のProject内末端を見落とさないよう503で観測を保留し、既存履歴を変更しない。枝全体を対象外と推測しない。

## 入力・更新の監査追補

- `1e`などnumber inputの未確定状態は、数値draftとは別のpendingフラグで保護する。同期や他項目の保存ackで途中入力を消さない。不正な値は送信せず、閉じる際は破棄確認する。新Issue/正規値への復元では前の検証エラーを残さない。
- 本文を編集して時間欄からSaveまたはCmd/Ctrl+Enterを使う場合は、同じ明示フォーム保存で両方を送る。時間だけの通常Enter/blurは本文を便乗送信しない。
- 開いたチャートは保存確定と集計データ変更を反映。進行中の古い履歴応答は描画せず、完了後に集約した1要求を送る。閉鎖中・title/bodyだけの同期では0要求。公開失効403は古い応答でも優先処理し値を隠す。
- 本番読取監査（2026-10-27）は移行済み2件/10h・未見積33件を確認。移行の実値やラベルをQAとして変更していない。初回panel前0要求、open時1要求、POST0・pageerror0。入力途中・明示保存・遅延応答はmockで再現。native IMEの実機入力は未検証、compositionイベントは合成試験。
