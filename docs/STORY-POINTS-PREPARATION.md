# PBI Story points 表示の準備（field契約待ち）

## 確認した既存経路

- server/github.mjs の CORE → normalize() → board/focusedBoardのlanes。focused取得ではdetail hydrateのコピー対象を明示しているので、field追加時にはこの経路も更新する。
- web/api-adapter.js はboardをそのまま保持する。web/app.jsのvalid()は既存必須項目を確認し、詳細は同じlaneオブジェクトをfillDetail/reconcileDetailで読む。
- PBI左セルはtitle、canonical assignees、青い進捗/件数。担当者行右端へ小さな「SP 0.1」等を配置する候補。未設定は正常に非表示。詳細は既存サイド欄にread-onlyで同じSPを置く。Taskでは表示しない。
- Worker BoardReaderは最大60秒の完全snapshotを再利用し、前後で公開scopeをlive確認する。fieldの公開性が変わる場合は同じガードにfield ID/type/visibilityを含め、旧値を再利用しない契約が必要。

## 提案する内部読取契約

`lane.storyPoints?: number | null`。numberはPBI自身のGitHub Issue field数値、nullは取得成功した公開fieldの未設定。property省略は未確認・非公開・取得不可。数値文字列やNaN/Infinityを数値に変換しない。

推奨見積もり列は0.1/1/2/3/5/8/13。読み取り側では値の丸め・子Task合算・AI再見積り・本文fallbackを行わない。GitHub正本に別の有限数値がある場合も勝手に別値へ変えない（ルーブリックの運用は別タスクで扱う）。8/13も普通のneutral/blue SP表示で、警告・必須・採用ブロック・分割強制を加えない。

準備済みのpublicPbiStoryPointsは未接続。server側resolverから渡される「対象fieldのID/type確認済み」「公開確認済み」がともにtrueで、type=PBIの場合だけ数値/nullを投影する。requestやクライアントのbooleanを信頼してはいけない。現在のGitHub query・本番レスポンス・UI・配信版は変更していない。

## 親から必要な確定情報

1. org Issue fieldの正確なIDとNUMBER型、正本APIのquery/response shape（未設定・取得不可の区別、paginationを含む）。表示名だけで同名Project fieldへfallbackしない。
2. 既存GitHub App installationで読めること。追加権限が必要なら別承認。こちらから設定変更しない。
3. public-temporaryで公開可能なfield visibilityの確認方法と承認。org-onlyはレスポンスに含めない。公開から非公開への変更をsnapshotガードで検知できること。
4. PBIのtype境界とfield未設定時の仕様。上記proposalと差があれば契約に合わせる。

## 接続後に必要な試験

- 0.1/1/2/3/5/8/13、null、旧snapshotでpropertyなし、malformed/取得失敗、Taskの値を混入しない。
- 同じIssue IDでTaskの子だけ値が変わってもPBI SPは不変。PBIの正本値変更は45秒poll/focus/onlineでboard/detailへ反映。
- PBI title/担当avatar/ゲージ/件数を圧迫しない6行、1920/2560、長title、多担当。SP表示でdirtyにならず保存patchに入らない。
- fieldが非公開になった直後のsnapshot hit/miss、旧inflightの破棄、公開確認失敗時に前のSPを再表示しない。
- GitHub queryは既存のPBI hydrationへ加えるか必要な軽い読み取りだけ。初回board/detailのcritical pathを計測し、全Taskへ無駄にfieldを取得しない。
- 実IssueへのQA書込みなし。未設定に対する通知・Actionsメッセージ・必須チェックを追加しない。

## 現段階の検証

投影と後読込readerのmock単体試験7件を実装。npm run check（lint/typecheck/unit/build）成功。既存78件と追加7件の計85件が成功。まだHTTP adapter/board/detail表示を実装・配信していない。UI変更がないためE2Eは今回再実行していない。field設定・Issue設計の別作業を重複変更しない。

## 2026-10-27 確定したREST契約と準備実装

親側のPR844（head `4bd072fc110d362cd08452cba2700460b2bd28a4`）で契約を確認。Story points はまだ未作成で、IDは存在しない。既存4fieldは organization_members_only。Effortを代用しない。

- 定義: `GET /orgs/engineer-first/issue-fields`。`id/name/data_type/visibility`を検証し、確定ID・名前Story points・number・allの完全一致のみ許可。visibility欠落も非公開扱い。
- 値: `GET /repos/engineer-first/idea-boost/issues/{number}/issue-field-values?per_page=100&page=N`。`issue_field_id/data_type/value`を使い、数値文字列は変換しない。Number実値の実接続は未観察。
- [GitHub公式の定義API](https://docs.github.com/en/rest/orgs/issue-fields) は組織 **Issue Fields: read** を要求する。既存のIssues:writeとは別権限であり、現在Appでの実接続は未検証。ローカルghのユーザー認証成功をAppの成功とみなさない。
- [GitHub公式の値API](https://docs.github.com/en/rest/issues/issue-field-values) はrepository Issues:read。既存Issues:writeは値側の必要権限を含むが、実際のNumber値取得成功は未確認。

`readPublicPbiStoryPoints` をmock実装。既存board/read/saveには未接続で、HTTP endpoint・UI・本番設定は追加していない。公開承認と正の確定field IDがなければ要求ゼロ。サーバー検証済みの表示PBI最大6件のみを対象とし、最大3並列・最大10ページで後読みする。定義と既存scopeを前後に検証し、途中の非公開化・確認失敗では全結果を破棄する。個別値の失敗はそのPBIを省略し、完全取得で当該fieldがない場合のみnull。結果は置換用で、古いSPとのmergeは禁止。

HTTP adapterは次回実装時にLink paginationを正確に`hasNextPage`へ変換すること。任意URLのfollowは禁止し、固定repo/Issueへの数値pageのみ使う。`assertScope`は既存の公開範囲を確認し、PBI一覧はクライアント申告をそのまま信頼しない。後読込応答はscope/世代一致時だけ適用し、切替・非公開化・エラーでは古いSPを消す。ポイントを60秒board snapshotに埋め込まず、board/本文表示の待機条件にしない。

未完の依存は **field作成とID、公開承認、Appの定義read可否**。権限設定は変更していない。現在のApp token発行はissues/organization_projectsへ限定され、定義readを正規に確認する経路も未接続。秘密を取り出して検証せず、必要な権限追加は親の別承認を待つ。この準備コードは本番配信しない。UI・両解像度・本番読取/性能測定は接続後に行い、mock成功を実接続成功とは報告しない。

## mock UIの準備

`adapter.loadStoryPoints(pbis)` を任意capabilityとして追加。既存production adapterには実装せず、未接続時は追加要求ゼロ。表示中最大6 PBIのID/番号を渡し、`{values: {[issueNumber]: number|null}}`を独立で受ける。UIは有限数値だけ表示し、null/省略/不正値は非表示。state参照・adapter・表示PBI集合・世代番号が一致する応答だけを受け、旧scope/旧pollの遅延応答を無視する。個別取得失敗はSPを隠す。scope_not_publicは既存全体停止処理を即時実行し、SPも消去する。

PBI担当者行右側と詳細サイド欄へ同じbadgeを配置。更新はbadgeのtext/hiddenのみで、ボード全再描画・editor baseline変更・dirty化を行わない。次回HTTP接続では通常request timeout/取消を適用し、任意capabilityへの入力をサーバーで再検証する。現在はmock adapterのみである。

追加browser試験は両サイズ計8件: 0.1/1/2/3/5/8/13、未設定・非公開の空結果・403・不正値、6PBI/長タイトル/担当者/ゲージ矩形包含、未解決のSP取得中にboard/detail表示、Taskでは非表示、poll後の更新・旧応答破棄、dirty title保持、scope非公開化の即時消去、production adapter追加要求ゼロ。画素は `.wrangler/story-points-1920.png` と `story-points-2560.png`（ローカルignored）で確認。これは実GitHub接続や通信時間改善の実測ではない。

UI準備後の検証: `npm run check`成功（単体/統合85件）、`npm run test:e2e`成功（両解像度196件、53.6秒）。実Issue/PR/コメントへのQA書込みゼロ。本番App接続・本番SP表示・実ネットワーク性能は未検証で、配信していない。先の「UI未実装/E2E未実施」はreader単体準備時の記録であり、この節が最新状態。

## 確定契約のローカル接続（未配信）

親からPublic見積値の承認とfield作成の読戻し結果を受領:
- org field ID `49067031` / node `IFN_kgDOAuy0Fw` / Story points / number / visibility=all。
- Project参照 `PVTF_lADOEYcVLM4Bb8yFzhnWjbg` はisIssueField=trueで上記org fieldを参照。ただしProject側を別の正本やprivate判定の代用にしない。
- 実Issue値は未入力。Number実値の本番応答はまだ未観察。

`GET /api/story-points?issues=1,2,...` をローカル実装。`STORY_POINTS_READ_ENABLED=true` の明示設定時だけhealthがcapabilityを返し、UIが専用後読込を開始する。現行production設定には追加していない。最大6件・重複なし・固定正数番号のみ。定義GET前後のnumber/all/ID一致と公開repo/Project確認、値GET前の正式Project所属/直接PBI親とPBI型確認を行う。Task/無関係Issueの値は読まない。表示board全取得・本文取得・全担当者取得は追加しない。RESTのLinkは同じ固定endpoint・per_page=100・次のpageだけ許可し、任意URLへfollowしない。scope_not_publicは通常のSP失敗へ潰さず全体停止へ伝える。定義拒否は空のSPとしてボードを継続し、別APIで回避しない。

Appの実読取は未検証。現在の通常クライアントは秘密鍵をCloudflare runtimeから受け取り、token生成の要求権限をissues:write/organization_projects:writeに限定している。配信済みAPIはfield定義/任意GraphQLを実行する入口を公開していない。ローカルに本番秘密鍵を取り出さず、push/deploy禁止を守った状態では、この新GETを本番Appとして実行できない。userのgh tokenや公開匿名GETをApp確認と偽らない。公式の定義GETに必要なのは組織Issue Fields:read、値GETはrepository Issues:read。権限追加もtoken要求権限の拡張も実施していない。Project経由で現在visibilityまで検証できるという実応答証拠もないため、その代替は実装していない。

次の正規接続確認は、配信承認を得た後に限定endpointを通常runtimeで実行して可否を確認するか、既存の安全なApp検証経路が親側で提供された場合だけ行う。403なら別経路へ迂回せず必要な組織read承認を求める。現在は本番配信・App検証のための秘密移動をせず、ローカルmockで閉じる。

確定契約接続後のローカル検証: `npm run check`成功（52 server＋38 integration＝90件）、全E2E198件成功（57.1秒、1920/2560）。追加API試験は未有効時の要求ゼロ、確定field、PBI正式所属、定義403/Taskで値要求ゼロ、型・公開性変更、Linkの外部URL拒否、repo非公開化の403、最大6件/重複/不正query、token要求権限不変を検証。ブラウザーではhealth capability→専用GET→board/detailの後読込接続をmockで検証。実値・実App権限の検証ではない。push/deployは親の禁止を維持し、ローカルコミットのみ。

## 保存UXと編集接続（2026-10-27、ローカル検証）

最新の承認でmain反映と配信が許可された。PBIセルは数字のみ、sidebarは7択と解除。公開field49067031の現在値を確認してから変更可能にし、未操作の未知値は保持する。POSTは対象field1件だけ、解除は対象fieldのDELETEを使い、全置換PUTは使わない。実Appのorg Issue Fields read可否は通常runtimeの読取で確認する。権限追加は別承認であり、この変更では実行しない。

Issue保存はdrawerから独立したIssue別jobとimmutable intentを持つ。同Issueは1flightで、送信後の入力は別の未保存差分として保持する。X→Yの送信中にXへ戻しても、Y確認後の明示SaveでXを送れる。別Issueは並行可能。closeは同期的にmodalを解除し、失敗は画面外から下書きを復元できる。unknown/partial/conflictは自動再送しない。先行GETは確認済みmutation世代を越えてstateを巻き戻せない。

保存前のclient全board GETを削除し、serverの全board構築2回を対象Issueのfresh context/preflight/readbackへ置換した。正式所属・公開状態・revision/fingerprint/rawStatus確認は維持。担当者一覧は担当変更時だけ取得する。SP値は別のfresh値preconditionで競合検出する。

合成計測（各upstream要求20ms遅延、3回、実GitHub書込みなし）: 旧要求数15回、292/278/282ms（中央値282ms）。新要求数5回、113/109/111ms（中央値111ms）。通常本文保存の比較であり、SP保存や実GitHubのネットワーク時間ではない。実IssueへのQA書込みは行わないため本番保存時間は未計測。

本番の既存App検証結果: 定義GETはHTTP403。追加権限を勝手に加えず、最終production flagをfalseに戻した。SPのUI/書込コードは配信済みだが機能は無効。組織Issue Fields:readの承認・installation token設定と正規read再確認が残る。実Issue値は書き換えていない。
