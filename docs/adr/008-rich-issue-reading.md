# ADR008: 本文中心の詳細と自動プレビュー

2026-10-26。利用者の最新指示を採用し、右80%を88%へ変更。作者・固定候補の担当者カード・Status色・目盛り進捗・書式列削除・媒体自動プレビュー・Mermaid表示を統合する。

## 正本と編集境界

Issue authorは既存CORE問い合わせにActorのlogin/avatarUrl/url/typeとUser.nameを追加する。担当者とは別の表示専用値で保存patchへ入れない。author欠落は不明表示。StatusはProject single-selectのcolor enumを既存metadataで取得し、意味の対応を維持したアプリの高contrast色へ写像する。GitHubのCSS色と完全一致とは主張しない。snapshotのscopeKeyへ色配列を加え、色だけの変更も既存世代fenceで旧readを切り離す。volatile snapshotはデプロイで再生成され、永続的な旧schema移行は不要。

担当者タイルは実assigneeOptionsと既存割当の和集合。候補外の現在担当者を消さず、複数/未割当を扱う。ボタン操作は既存draftのhidden selectへ反映するだけ。明示保存、同一fieldの競合、DO/idempotencyは変更しない。Statusも同じ方式。下書き/保存時の入力ロックと色は別責務。

## 媒体

**ADR006の『クリックまで動画通信ゼロ』を置き換える。** 近傍150pxへ来た未知添付は自動で画像を試し、画像デコードの失敗時だけpaused videoのmetadata/先頭フレームへ進む。HEADは実公開添付で403、cross-origin fetchはCORSで利用できないため、connect-srcを広げずnative elementを使う。credentials proxy・外部変換・upload・canvas抽出はない。

画像専用queueは同時3、未知/動画のpreview queueはdialogごと同時1。後者の画像判定から動画への遷移も同じ枠の中。動画はpreload=metadata/playsinlineで、必要時だけ先頭0.001秒へseek。play()は自動で呼ばない。手動playが起きたらpreview処理を完了させ、遅延metadata/data callbackと12秒timeoutがユーザーの再生をseek/停止しない。成功後preload=none。preloadはブラウザーへのヒントで転送bytesの厳密な上限ではない。

画像/動画の判別結果だけ最大64URL・5分のmemoryへ保持。画像bytes・動画bytes・署名URLを独自永続cacheしない。DOMは同じ本文なら維持する。close/private化/本文変更は監視とsrcを破棄し、closing中の待機要求開始も禁止。失敗/期限切れ/codec不対応は元リンクを残し、黒枠だけを成功としない。

## Mermaid renderer選定

[Pele 1.10.0](https://github.com/obsidianmd/pele)をexact pin。[公式API](https://pele.run/api)、[安全設定](https://pele.run/security)、[互換性](https://pele.run/compatibility)を確認した。Mermaid 12.2.0に対し、DOMなしの同期SVG生成、runtime依存なし、images:false/links:falseを明示できる点が今回の小さな構成に合う。新しいrendererなので長期実績は未確立。配置はGitHub/Mermaidと異なり、全構文の完全互換性を保証しない。2エンジンを併用しない。

図が近傍に来て初めて専用Workerを読み込み、1図ずつ描画。12,000文字/300行/150辺/出力500,000文字、queue20、3秒でworker.terminate。入力中・IMEで原文へ戻った際はwidget破棄とstale結果抑止。作者指定frontmatter/directiveは拒否、optionsはアプリ所有のみ、icon/math resolverなし。SVGをDOMPurifyでも処理し、リンク・画像・script・foreignObject・animationを除去、外部URL参照属性を落とす。図コードはGitHubAppや第三者へ送らない。worker-srcはselfだけ追加。

表示はnativeサイズを超えて自動拡大しないFit、＋/−/0、拡大後のscroll/drag移動、元コード表示。通常wheelを奪わない。liveの鉛筆/選択でMarkdown原文編集へ戻る。解釈不能/時間超過は図だけに短いエラーとコードを残す。本文・コメント・boardを図のimport/render待ちにしない。
