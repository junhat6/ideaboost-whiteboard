# 作業Issue見積時間とバーンダウン

## 正本と対象

- 正本は組織Issue Field `Estimate Hours`（Number / Public）。PBI配下の作業Issueの全体見積時間hであり、実績時間・残作業の自己申告・PBI Story points換算ではない。任意、未設定はnull。0は明示値としてのみ認める。
- 公開fieldのID・型・公開範囲を開始/終了に検証し、Projectの参照field経由で取得する。通常boardの既存作業Issue queryへ同梱し、作業IssueごとのREST waterfallを追加しない。Project外の作業Issueを推定して加えない。
- スプリントは固定repoの正式milestone番号。view 16のPBIと正式子孫のうち、作業Issue自身または所属PBIのmilestoneが一致する対象。作業Issue自身にmilestoneがある場合はそれを優先し、二重計上しない。表示6PBI・担当者・検索filterは集計対象に影響させない。
- Status「完了」またはIssue CLOSED/COMPLETEDを完了とする。ただし見送り/CLOSED NOT_PLANNEDは取消として除外し、完了成果へ含めない。Issue closedだけで理由不明の場合は完了と推定しない。

## 観測履歴

- 既存Cloudflare内の専用Durable Objectへ、全ページ取得成功時の観測のみ保存。JST日付、観測時刻、正式scope、作業Issue ID/parent/estimate/null/status/completeを持つ。部分取得・取得不能・非公開化を0件として保存しない。
- 日次alarmで閲覧者不在でも取得。初回有効化より前の履歴は作らず、イベント発生時刻ではなく観測時刻として描く。途中追加・除外・再見積・reopenは新しい観測の差分であり、過去点を再計算しない。
- 閲覧時も最新の公開確認を行う。field/repo/Projectの公開失効時は履歴を公開せず、失効前の値を復活させない（履歴自体は保管し、再公開確認までは返さない）。ネットワーク失敗を正常な空履歴へ変換しない。
- 既存milestoneは期日があるが開始日がない（2026-10-27読み取り確認）。created_atを開始日と誤用しない。Sprint9は後述のユーザー明示学校日程を用いる。その他は学校日程が設定されるまで理想線を省略する。理想線の開始値は最新指示に従い現在の対象全体見積であり、開始時点の実測値とは主張しない。

## 操作と表示

- ボード右端3.5%のhover、明示ボタン、keyboard/touchからoverlayを開く。Issue drawer・drag中は自動表示しない。元boardの幅やscrollを変えず、Escape/backdropで閉じfocusを戻す。
- チャートと履歴通信は初回パネル表示時に遅延load。青ideal・赤actual、見積済hと未見積n件を併記。全未設定を0時間達成に見せない。観測開始前は空白。
- 作業Issue詳細は0.5 / 1 / 2 / 3 / 4 / 5 / 6 / 8hと未設定の選択式。選択直後に200ms集約autosaveする。正本は0〜1000hの数値のままで、既存の候補外値も現在値として表示・保持する。既存metadata autosaveの単一flight/最新意図/field単位ackと未知結果fenceを使い、本文やtitleを便乗保存しない。
- 実IssueのQA値入力・既存作業Issueの一括見積・既存label移行は行わない。

## 現在の外部設定

2026-10-27、既存ownerの正規画面で作成・同一項目のProject参照を確認。org field `49079931` / `IFN_kgDOAuzmew`、Project field `PVTF_lADOEYcVLM4Bb8yFzhnZdjc`。Number / Public。現存のPBI以外の全種類と種類なしへpin。App権限・既存Issue値は変更していない。

## 種類と階層

種類名の列挙を認可に使わず、固定repo内の正式なPBI祖先を持つ非PBI Issueを編集対象とする（最大8階層）。未知の種類も同じ規則。集計は末端作業のみで、親作業の見積を子と合算しない。子件数差分は正式subIssuesとProject所属を追加照合する。Project外と確認した直接の子は対象外件数として示す。Project内なのに欠落した子や不完全応答は観測を確定せず、取得不能を0件にしない。PBI自身はStory pointsのまま。

## 保管と負荷の上限

- 日次はJST 00:10。配信後の正規readでDOを起動し、その後は閲覧者なしでもalarmで継続。alarm再実行は同日同内容のsignatureで冪等。
- alarmの一時取得障害（HTTP 429/500/502/503/504、source呼出しの通信失敗）には60秒・5分・15分のbackoffを使い、JST日ごとの追加短期retry予約は3回まで。`alarm-retry`の`{day, attempts}`を永続化し、GET・成功・再起動では同日のbudgetを戻さない。使い切った場合は次のJST 00:10へ戻す。公開失効403・不完全取得`observation_incomplete`・成功応答のJSON/値検証エラー・storageエラーには短期retryを追加せず、偽の観測を保存しない。`observation_incomplete`・`scope_not_public`・`estimate_hours_not_public`は、HTTPのerror codeだけでなくsource呼出しがrejectしたErrorのmessageでも短期retryから除外する。
- GETの初期alarm予約とalarm後のbudget/予約を同じqueueで直列化し、budget更新と予約は小さいstorage transactionで確定する。通信はtransaction外。既存の早いalarmを遅い予約で上書きしない。制限はアプリの追加短期予約数であり、runtimeのat-least-onceによる実行回数上限を主張しない（[Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)、[Storage transaction](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction)）。
- 観測用board取得は確認できたGitHub通信障害・一時HTTP障害だけを`observation_unavailable`とし、形状・ページング・GraphQL等の不完全取得と区別する。後段の子関係取得も、GitHub失敗を包むHTTP502だけではretryせず、`github_request_failed`の`upstreamStatus`が上記一時statusの場合と`github_network_error`だけを対象にする。その他の`github_*`、`invalid_private_key`、`estimate_hours_unavailable`は認証・設定・field契約・応答検証不足として短期retryしない。通常boardの応答と認証処理は変更しない。
- immutableな各観測と、日ごとの最終観測への小さいindexを原子的に保存。チャート読取は最大180日分のindexだけを読み、全作業snapshotを毎回メモリ展開しない。保持180日、1日最大96観測。上限時も現在値は確認するが履歴の制限を表示し、過去点は上書きしない。
- 同時閲覧はsingleflightで共有し、完了後の閲覧は新しい公開確認を行う。TTLで公開確認を省略しない。最大500末端作業・100milestone、完全性を超えた応答は観測不能として扱う。
- 初回boardへ履歴API/チャートimportを加えない。別途数値の初期入力や実Issue QAは行わない。
- 観測専用の内部読取では編集用の担当者候補RESTを要求しない。候補一覧の遅延・障害で履歴取得を待たせず、通常boardの担当候補取得と公開性・全件取得・対象Issueの検証は変えない。

公開性の確認不能（optional queryのfallback等）は503、一致した正規fieldのORG_ONLY確認は403。いずれも記録を返さず、既存履歴を消去しない。再公開を正規readで確認できた場合のみ保管済み履歴を再び閲覧可能にする。

実データのread-only照合でSprint 9のPBI #132にProject外の子 #226があることを確認した。対象は既存boardと同じProject 3内の末端作業。件数差分がある親だけ正式な直接の子・全Project所属を読み、Project外/対象外を明示する。初回boardにはこの履歴用追加queryを入れない。実Issueを勝手にProjectへ追加せず、Project内の読取欠落は引き続き拒否する。

Project外の直接子を除外できるのは、正式な子件数が0の末端と確認できた場合だけ。中間作業または子件数不明は、その先のProject内末端を見落とさないよう503で観測を保留し、既存履歴を変更しない。枝全体を対象外と推測しない。

## 入力・更新の監査追補

- 選択式への変更でnumber input専用の未確定文字列・validation状態を撤去。既存の0・小数・候補外値を現在値として残す。本文・タイトルのIME保護は維持する。
- 時間選択は本文を便乗送信しない。本文はmetadata保存後もdraftとして残り、明示SaveまたはCmd/Ctrl+Enterで保存する。
- 開いたチャートは保存確定と集計データ変更を反映。進行中の古い履歴応答は描画せず、完了後に集約した1要求を送る。閉鎖中・title/bodyだけの同期では0要求。公開失効403は古い応答でも優先処理し値を隠す。
- 本番読取監査（2026-10-27）は移行済み2件/10h・未見積33件を確認。移行の実値やラベルをQAとして変更していない。初回panel前0要求、open時1要求、POST0・pageerror0。入力途中・明示保存・遅延応答はmockで再現。native IMEの実機入力は未検証、compositionイベントは合成試験。

## 学校日程・再表示（2026-10-27更新）

Sprint9はユーザー明示の2026-10-21/22/23/26/27/28 JST。日程初期値をversioned codeに保持し、編集はHISTORY DOのschool-days:<milestone>へ保存する。日程は60日・180日間以内、実在日付・重複なし。scope/公開性を新規確認し、期待revisionで競合を検出。直近request receiptを同じ原子的putに保存し、同IDを再適用しない。GitHubのIssue/Project設定は書き換えない。

横軸は学校日を等間隔で表示。青い理想線は現在の全対象見積を開始値として最終日0へ。未見積は件数として併記し0確定にしない。赤い実線は学校日に存在する観測のみ（過去の未観測・未来は空白）、学校日以外の観測も内部記録には残す。日程/全体見積変更はidealだけ再計算し、保存済みactualを修正しない。

再openはsame sprintのメモリcacheを即描画し新しいGETを開始。古いGET/保存ackの世代保護を維持。非表示中の定期GETを追加しない。失敗は前回値と観測時刻に短いerror、public/auth失効とscope変更はcache破棄。scopeを跨ぐ混在と永続ブラウザー保存をしない。

日程POSTの成功応答では送信時の入力snapshotと現在の下書きを比較し、送信後の追記をdirtyのまま保持する。保存済みrevisionだけ更新し、続くGETで下書きを上書きしない。後続変更は自動送信せず、次の明示保存で新revisionを使用する。

明示保存時に下書きが最新取得済みの日程と同値ならPOSTを省略し、その取得値のrevisionへ再照合して仮選択・エラー表示を解除する。次の編集は再照合したrevisionで保存する。取得だけではdirtyな下書きやrevisionを更新せず、保存結果不明の自動再送もしない。未設定の空日程を初めて明示保存する場合は、再提案を防ぐため従来どおりPOSTする。

日程のdraft/revision/saving/errorはmilestone別に保持し、scope失効時に破棄する。保存中の別スプリントを表示しても日程を混ぜず、遅いackは元のmilestoneだけを更新する。表示対象の日程保存中は履歴再取得を保留し、ack以前の応答で保存済み日程へ巻き戻さない。

赤線は隣接する観測済み学校日のみ接続し、途中の未観測日は空白として別subpathにする。CLOSED/DUPLICATEは正式なstateReasonとして受理するが、それだけで完了・取消とは判定せず、非Doneなら残り見積に保持する。

## 学校日カレンダーと未見積強調

日付textarea・候補開始日の入力を撤去し、月移動と独立した日付toggleのカレンダーを使う。非連続の6日や月をまたぐ日程も選択でき、選択数と状態は文字・チェック・aria-pressedで示す。矢印/Home/End/PageUp/PageDownで移動し、Space/Enterで選択する。最大60日・180日間の制約は変えない。選択は保存ボタンを押すまでPOSTしない。

未設定スプリントの初回の日程展開だけ、JST今日から期日までの平日を未保存候補にする。過去/不明の期日、180日超または平日60日超は空候補。候補はスプリント開始日や実際の授業を保証せず、祝日・休講は個別に外せる。revisionが付いた保存済み空日程も尊重する。初回候補の決定、選択日、表示月はスプリント別で、再open・背景更新・保存中の追記・別スプリントの遅いackが上書きしない。

主値は「残り：61h」の形式に統一。「観測の内訳」UIは撤去するが、観測の保管・内部診断データは変更しない。ボードの未見積強調toggleは初期OFF。公開性と取得が確定したnullだけを対象にし、0/未取得/非公開/PBI/中間作業は除外する。typeの付箋色は残し、穏やかな輪郭pulseとreduced-motion時の静止輪郭を用いる。保存結果が確定した値を反映し、公開失効で状態を消す。閲覧補助だけで、実Issueの変更や追加のAPI取得はしない。
