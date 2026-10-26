# 006: コメント投稿と遅延メディア

2026-10-26。利用者は匿名公開のURL所持者がGitHub App名義でコメントできることを承認した。個人のログイン名義と偽らない。コメント編集/削除は提供しない。

## コメント境界

GET/POST `/api/issues/:number/comments` は固定repositoryとProjectの正式なIssue範囲をfresh boardで照合。PBI行フィルターだけでは子Issue範囲を限定しない。前後公開確認、Origin、認証/public固定path/host、既存rate制約を保持。GETは50件ずつ昇順のページ取得、全件保存やboard snapshotへの混入はしない。重いコメント取得を初回board/Issue描画の待ち条件にしない。現実装は範囲照合にfull board読取を使うためコメントだけ数秒かかり得る。

POSTはIssue本文保存と同じper-issue DO queueを通す。route+Issue+body digest+requestIdをdurable intentへ記録し、endpoint専用の構文検証はintentより前。成功時はcomment ID/URLだけをreceiptへ保存し、同ID再要求は現在scope確認後にreceiptを返す。本文・tokenは保存しない。ネットワーク/5xx/不正な成功応答/成功直後の公開確認失敗はambiguousとし、durable fenceを解除しない。GETだけで解除せず、管理者の確認を要する。POSTを自動再送しない。成功後GET失敗は投稿失敗へ戻さない。

コメント下書きはIssue本文と別のメモリー状態。取得失敗や更新では消さず、送信中は二重投稿・Issue切替・closeを止める。未知結果のrequestId/停止状態は同一ページの再表示でも保持。page reloadでもDO側の未確定fenceが再投稿を拒否する。実チームへのQAコメントは投稿しない。

既存installation tokenのIssues:writeで利用できる。App権限・鍵・namespaceは追加しない。

## メディア境界

**追補:** 以下は初期契約の記録。最新の利用者指示により、操作前取得ゼロと手動媒体選択は[ADR 008](008-rich-issue-reading.md)の近傍自動previewへ置き換えた。自動再生禁止、許可URL、公開境界とcleanupは継続する。

CodeMirrorは原文を保持。previewはDOMPurifyのinert fragmentから許可したGitHub添付URLだけを新DOMへ変換する。raw imgのイベント属性や任意iframe/video HTMLは通さない。画像はIntersectionObserver(dialog root、200px)でsrcを設定、動画は明示操作まで要素/srcなし。拡張子なし添付を動画と断定せず「動画として再生」「画像として表示」を用意。コードフェンス内URLは変換しない。

HTTPS、正確なhost/path、userinfo/nondefault port/query/hashなしを検証。github.com/user-attachments/assetsとuser-images.githubusercontent.comの添付だけを自動媒体候補にする。CSPも観測したGitHub添付と `github-production-user-asset-6210df.s3.amazonaws.com` のみに限定。任意S3/https全域や認証付きproxyは導入しない。元リンクは常に表示し、403・期限・未対応codecはブラウザー依存の制約として扱う。閉じる/切替でvideo pause、src除去、observer disconnect。

実Issue688の既存公開添付はGET Range 1 byteでvideo/quicktimeを確認。HEADは署名メソッド差で403になり得るためUIの型判定に使わない。これは再生の保証ではなく、配信ブラウザーで別途確認する。実動画のアップロード・変更はしていない。

参考: https://docs.github.com/en/rest/issues/comments / https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files

## 追加の失敗境界

WorkerからDOへdispatchした後の通信断も503/ambiguousとして扱い、新しいrequestIdでの再投稿を促さない。投稿受付後の公開確認でscope_not_publicが判明した場合は、そのコードと曖昧結果fenceを両方保持する。UIはコメント経路からの非公開判明でも既表示board/detail・下書き・媒体・observerを即時破棄する。

古いページ取得が確定投稿を消さないよう、現在の詳細表示中に確認した直近10投稿をメモリーに保持する。取得ページに未収録なら「投稿したコメント（投稿時の内容）」と明記し、現在の取得結果と区別する。詳細の再表示で破棄し、永続コメントキャッシュにはしない。
