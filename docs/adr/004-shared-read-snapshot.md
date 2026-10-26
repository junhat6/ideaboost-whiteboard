# 004: 公開確認付きの短命な共有読み取り結果

2026-10-26。3.5秒以内の実カード表示を目標に、ADR003の「毎回全取得」の初期表示契約を限定的に変更する。

## 判断と適用範囲

既存SQLite Durable Object namespaceの専用名 `engineer-first/idea-boost:board-reader` を共有読み取り窓口にする。per-issue保存queueとは別インスタンスであり、読み取りを保存queueに並べない。同じdefault/milestone読み取りが進行中なら単一のGitHub取得を共有する。namespace、鍵、App権限、有料プランを追加しない。

保持するのはdefault scopeの完全な応答1個（最大2MB、元のfetchedAtから60秒）のメモリー上のコピーのみ。永続storage、CDN、ブラウザ/localStorageへ保存しない。eviction・deployで消える。進行中の取得は最大8。初回GETだけX-Board-Snapshotを要求し、以降の45秒/focus/online/manual取得はfresh。特定milestoneは共有進行要求のみで、保存スナップショットを再利用しない。

新規ブラウザでも他の利用者または直近の利用による共有結果があれば高速表示できる。サーバーにも結果がないcold miss・60秒経過・eviction後は元の全取得時間がかかる。翌朝や全利用者の真の初回3.5秒を保証する方式ではない。

## 公開・更新境界

snapshot hitでもGitHub repository/Projectの公開状態・保存済みview filter・Status選択肢を開始・終了でライブ確認する。filter/Statusの不一致でも共有結果を捨てて再取得する。失敗・不明・非公開なら返さず破棄する。通常のfresh取得は既存の前後公開確認を維持。HTML/APIの外側は従来の認証または承認済みpublic path/host/Origin/rate制約とprivate,no-storeを継続。公開状態そのものをキャッシュしない。複数APIと外部GitHub設定変更は原子的ではなく、最終確認直後の変更窓は既存の制約として残る。

保存要求はper-issue DOに入った後、読み取りDOへ開始通知してepochを進め、snapshot/進行要求の共有参照を破棄する。完了時も同様に無効化する。保存中の読取はキャッシュを書き戻さず、以前開始したreadもepoch不一致ならキャッシュを復活させない。開始通知に失敗すれば書き込まない。終了通知だけが失敗してもGitHubの確定した保存結果は変えない。snapshot再利用は停止側になり、保存の自動再送を誘発しない。GitHubの部分保存・結果不明では終了通知による解除を行わない。未完了writerは最大1024、過剰ならfail closed。DO再起動ではsnapshot自体が消える。

mutationのscope/preflight/readbackは従来のhandlerを直接使用し、snapshot・共有readのいずれも利用しない。狭いpatch・revision/fingerprint/rawStatus・永続request記録を維持。

## UI契約

元fetchedAtとageを保ち、「直近の取得結果・最新確認中」を表示して即座にfresh GETを開始する。内容の欠けたsummaryではないため、原文の全文検索・Demo goal・担当者・詳細閲覧は利用可能。ADR005により入力は即時可能。保存はfresh baseline照合を経由し、dragは最新確認完了まで止める。失敗時は理由と文脈に応じた再確認を出す。公開範囲変更が判明したら既表示カードを消す。通常のdirty draft保護と同期再開は継続。

## 計測基準

cold client/cold shared reader、cold client/warm reader、同じclientの再訪を分ける。表示は選択6PBIの実カードが出た時点、fresh完了は再取得が終わった時点。最低3回の中央値/範囲と元データの年齢を記録する。warm snapshotの3.5秒達成をcold達成と呼ばない。

参考: [Cloudflare in-memory state](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/)、[Free plan pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)。メモリー保持は保証されず、無料枠超過時は失敗し得る。常時alarm/Webhook/永続スナップショットは導入しない。
