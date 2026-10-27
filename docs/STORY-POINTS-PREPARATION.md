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
