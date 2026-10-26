# ADR007: 同一面のMarkdown編集とコメント専用scope

## 判断

コメントGETが毎回board(env,null,false)を作り、全Projectの関係・本文・担当者・fingerprintを取得していた。本番改善前のIssue823 GETは3回で13799/12001/12353ms。本文の表示は独立していたがコメント表示には約13秒必要だった。

コメント専用scopeは、固定repoの対象IssueについてProject3の非archive所属をprojectItems(includeArchived:false)で全ページ検証する。所属がなければtype=PBIに限り、Project3内の正式な直下子をparent-issueフィルターで取得し、返されたparent.idとrepoと非archiveを再照合する。元のunfiltered write scopeと同じで、view16・milestone・本文リンクを認可に使わない。欠落/ページング異常は拒否。開始公開確認をscope queryへ統合し、GET後/POST前後の公開確認を維持。scope、comments、visibilityをServer-Timingへ記録する。キャッシュによる鮮度変更や権限省略はない。Issue本文のmutation経路は変更しない。

## ライブ編集

CodeMirrorの構文木とStateField直接提供のDecorationを使用する。selection.rangesのいずれかと交差する行/ブロックでは原文を表示し、非選択行の記法をreplaceで隠す。入力・Undo・保存の正本は常にMarkdown文字列。未編集部分は差分パッチで改行を保ち、Undo/RedoはCodeMirrorのinvertedEffectsとともに元の原文を復元する。HTMLへ逆変換しない。GFMを明示した既存Lezerパーサーを直接依存へ記録する。

表・コード・添付は選択外で安全なwidget表示、鉛筆かカーソル移動で原文編集へ戻る。widgetは原文の同一性で再利用し、無関係な入力で動画を作り直さない。destroyで既存のobserver/媒体cleanupを使う。IME中は装飾を解除する。入力不能時はeditableとreadOnlyを併用し、書式ボタンもdisabled/composingを確認する。タスクチェックは表示上の記号で、クリックで勝手に原文を書き換えない。

原文切替と補助読み取り表示は小さなアイコンとして残すが、既定のライブ面だけで読み書きできる。ボード操作部は一行のグループとアイコンへ縮め、説明はヘルプに移す。失敗・競合・結果不明の説明は削除しない。

## 検証と制約

正式親子範囲の同値性、ページング、公開前後確認、重い全ボード問い合わせを呼ばない回帰、同一面の選択/Undo/CRLF、コード/表/媒体、動画通信開始条件を検証。既存の投稿receipt/曖昧結果/非公開消去と編集同期・close raceを継続。Playwrightのcontenteditable.fillはfocus時のDOM再装飾を無視するため、実際の全選択・入力キー経路で原文一致を検証する。

Obsidian/Notionと同じ機能一式ではない。コードは安全な整形表示、task checkboxは編集時に原文を変更する。OSネイティブIMEの完全検証は未実施。

参考: https://codemirror.net/examples/decoration/ / https://codemirror.net/docs/ref/ / https://docs.github.com/en/graphql/reference/issues / https://obsidian.md/help/edit-and-read
