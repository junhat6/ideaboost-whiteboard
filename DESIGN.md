---
version: alpha
name: IdeaBoost Team Whiteboard
description: 白い作業面で日本語Issueとチームの進行を俯瞰する、静かで正確なデスクトップホワイトボード。
colors:
  canvas: "#f2f6fc"
  surface: "#ffffff"
  surface-soft: "#edf3fc"
  ink: "#182b49"
  muted: "#475569"
  line: "#c9d5e7"
  primary: "#3159c9"
  progress-complete: "{colors.primary}"
  focus: "{colors.primary}"
  selected: "#e8effc"
  input-border: "#7d8da8"
  raised: "#ffffff"
  avatar-fallback-bg: "{colors.selected}"
  avatar-fallback-ink: "{colors.ink}"
  primary-hover: "#2447a8"
  on-primary: "#ffffff"
  todo: "{colors.status-gray}"
  doing: "{colors.status-yellow}"
  wait: "{colors.status-orange}"
  done: "{colors.status-green}"
  status-gray: "#57606a"
  status-blue: "#0969da"
  status-green: "#1a7f37"
  status-yellow: "#9a6700"
  status-orange: "#bc4c00"
  status-red: "#cf222e"
  status-purple: "#8250df"
  status-pink: "#bf3989"
  progress-track: "#e7eefb"
  progress-pending: "#c0cfea"
  status-selected: "#e8effc"
  dark-progress-complete: "#8aa9ff"
  dark-selected: "#283b5e"
  dark-input-border: "#8394b0"
  dark-focus: "#a8b6ff"
  dark-primary-hover: "#c7d0ff"
  dark-progress-track: "#24324a"
  dark-progress-pending: "#596d91"
  dark-status-selected: "#303b49"
  note-yellow: "#FBDF7F"
  note-blue: "#9ECCFA"
  note-neutral: "#E7E9EE"
  card-ink: "#24292F"
  note-pink: "#fceef1"
  note-green: "#ecf5ed"
  error: "#a72a35"
  error-surface: "#fff0f1"
  dark-canvas: "#181b21"
  dark-surface: "#232730"
  dark-ink: "#eceef3"
  dark-muted: "#b7bfcc"
  dark-line: "#424b5b"
typography:
  title:
    fontFamily: system-ui, -apple-system, BlinkMacSystemFont, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.5
  editor:
    fontFamily: system-ui, -apple-system, BlinkMacSystemFont, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.85
  body:
    fontFamily: system-ui, -apple-system, BlinkMacSystemFont, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
  card:
    fontFamily: system-ui, -apple-system, BlinkMacSystemFont, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.25
  label:
    fontFamily: system-ui, -apple-system, BlinkMacSystemFont, Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.4
rounded:
  sm: 4px
  md: 8px
  lg: 12px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 8px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  issue-card:
    backgroundColor: "{colors.note-yellow}"
    textColor: "{colors.card-ink}"
    typography: "{typography.card}"
    rounded: "{rounded.sm}"
    padding: 5px
  issue-card-research:
    backgroundColor: "{colors.note-blue}"
    textColor: "{colors.card-ink}"
  issue-card-unknown:
    backgroundColor: "{colors.note-neutral}"
    textColor: "{colors.card-ink}"
  issue-drawer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.editor}"
    rounded: "{rounded.lg}"
    padding: 24px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px
---

## Overview

IdeaBoost のチームが、会議中に同じ一枚の作業面を見て状況を理解し、その場で GitHub の実データを編集するための道具。白い背景、読みやすい原文、安定した行列が主役。装飾や巨大な見出しで作業領域を奪わない。

参照したのは getdesign が公開する Linear / Airtable / Notion の独立したデザイン分析。マーケティングページの規則をアプリにそのまま移植しない。Linear から低雑音な境界と控えめな操作色、Airtable から構造化された情報と淡い色による区別、Notion から白い紙面と本文中心の落ち着きを採用する。ロゴ、独自フォント、暗いキャンバス、大きなヒーロー、販促カード、過剰な丸みは採用しない。

最新のStatus比較画像を優先し、GitHubの色輪郭＋淡い内側、neutralな選択面、明瞭な列マークを採用する。[Primer公式のsemantic color方針](https://primer.style/product/getting-started/foundations/color-usage/)を参考に、status-* / progress-* / status-selected を定義。既存ブランド参考は履歴として残し、type色と全体レイアウトは変更しない。色値は本アプリのcontrast選択でありGitHub全画面の完全複製ではない。

本ファイルは Google DESIGN.md alpha の YAML トークンと順序付き本文に従う。値の正本は YAML、用途と例外は本文。参照資料と取得手順は docs/references に保存する。

## Colors

最新の青基調参考に合わせ、canvasは#F2F6FC、白surface、ink#182B49、muted#475569、accent/focus#3159C9へ統一。Demo goalは白surfaceとinkの通常本文とし、薄いmetadata色を使わない。typeの黄/青とcanonical Status小マークは意味を保つ。入力境界はinput-border、選択面はselected、装飾境界はlineで責務を分ける。

既定はライトモード。キャンバスは `{colors.canvas}`、ボード・エディターは `{colors.surface}`、本文は `{colors.ink}`。補助テキストも `{colors.muted}` より薄くしない。フォーカスと主操作は `{colors.primary}` に統一する。

付箋色はGitHub Issue typeの固定対応。現在の正本にはPBI・Task・競合調査が存在する。Taskは参考画像の黄#FBDF7F、競合調査は青#9ECCFA、未知/nullは灰#E7E9EE。PBI左セルは淡青canvas #F2F6FCと最小構成を維持する。色はStatus・担当者・配列順から決めず、付箋内のtype文字・記号は置かず、操作バー内にTask/競合調査/その他・未設定の色凡例を表示する。カードと凡例は同じ分類関数・CSS色tokenを参照し、未知の実type名は凡例のtooltip・アクセシブルラベルへ含める。カード自身の実typeのアクセシブルラベルも維持する。カードタイトルはink #182B49でWCAG比は順に10.78/8.42/11.68。type面の基礎文字token #24292Fは11.14/8.70/12.06、補助文字#374151は7.84/6.12/8.49。focus#3159C9は黄/青背景で4.69/3.66、カード境界#8A7130/#456B91/#7B8290は各背景と3.56/3.31/3.18。参照20色をそのまま増やさず、実typeに必要な二色を選んだ。Status は列名とエディターの原語で判別できる。見送り・未設定・未知の状態を Done 色や完了集計へ混入させない。警告は赤の色面に必ず具体的な文言を添える。

ダークモードは操作メニューから明示的に選ぶ補助機能。自動で白いボードを反転しない。dark 系トークンと濃い付箋色に切り替え、読めるコントラストを維持する。ライトの設計・検証を優先する。

操作バーの2行目は現在のSprintと色凡例を同じ行にまとめる。現在のSprintはボード/チャートで選択中の過去Sprintとは独立し、公開確認した正式なGitHub Milestone期間だけを表示する。開始を含み終了を含まないJST境界を「00:00未満 JST」で明示し、正式な終了未定はそのまま示す。future/gap/closedは「現在のSprintなし」、不正/未知metadata・重複・読取失敗は「現在のSprintを確認できません」とし推測しない。専用GETは初回ボード描画後の後読取で、同時要求をまとめ、既存のボード更新時に5分cache・scope/JST日変更・明示再取得を判定する。新しいpollやlocalStorageは使わず、古い世代の応答を現在表示へ戻さない。公開失効時はボードと同時に消去する。

## Typography

日本語を OS 標準のゴシックで描画し、外部フォント通信を不要にする。英語向けの負の字間や小さな薄文字を日本語タイトルに適用しない。カードは `{typography.card}`、本文は `{typography.body}`、PBI は 14–18px。2560幅ではカードを14pxへ広げる。 [デジタル庁のタイポグラフィ指針](https://design.digital.go.jp/dads/foundations/typography/)で、OS書体の利用・用途に応じた行高・提供weightへのfallbackを確認した。一般本文の16px以上／原則14px未満を使わない基準への準拠を主張せず、この6PBI同時俯瞰ではタイトル12px（wide14px）・500・行高1.25・通常字間を用途上の選択とし、収まらないカードだけ11pxまで調整する。日本語の細部を潰さないよう一律600/700化や外部font追加はせず、既存inkとtype背景の十分なcontrastを維持する。最重要の見積hは12px/600へ上げ、塗りなしの未見積textも同じ書式を継承する（footerは16pxのまま）。

Issue タイトルは原文。勝手な略称、要約、番号への置き換えをしない。限られたカード領域では完全な行単位で表示し、長文はカード内スクロールとクリック先の全文で読めるようにする。部分的な行や文字を切らない。担当者名のみ省略可能で、アバターと名前の全文アクセシブルラベルを持たせる。付箋footerは16pxの非圧縮領域としてGitHub担当者avatarと見積hを常時表示し、名前は全文ariaへ残す。付箋内のtitle・担当者・見積・保存状態にnative/custom tooltipを出さず、hoverでタイトル全文を補完しない。PBI・操作バーのヒントは維持する。2×2でもfooterを隠さず、type記号・Status文字は置かない。Issue番号は2×2表示の付箋で省略し、1枚・2枚表示でも高さ80px以下なら省略する。大きな付箋では維持する。0h・選択肢外の値は丸めず保持し、公開確認済みnullは「未設定」、未取得・非公開・対象外は「—」で区別する。通常の再取得中は既知値を保ち、公開失効時はDOMの古い数値も即座に消す。 タスクタイトルは行高1.25、縮小下限11pxとし、2×2ではfooter20→16pxとcompact上下padding2→1pxによってタイトルの可用高を6px増やす（largeな2×2は上下padding5→3pxも合わせ8px増）。1920×1080・6PBI・overflowの先行CI実測では、タイトルbuttonの可用高は39.531px、11px/行高13.75pxのtext領域は27.5pxで2行だった。当初の約44.8pxという仮計算はcompact共通cellの高詳細度paddingを見落としていたため訂正する。compactのtask-cellだけ上下paddingを約10pxから約6pxへ上書きし、1枚あたり約4.2pxを戻し、修正後CIで可用高43.766px・3全行を確認した。同じ43字の日本語は11pxのまま25字→38字を表示する。PBI/goal列・横padding・grid gap・文字書式はこの補正で変えない。全ての長文が収まる保証はせず、全文は付箋内scrollと詳細で維持する。文字とavatar・hは重ねず、PBI左列タイトルは変えない。

## Layout

1920×1080 と 2560×1440 のデスクトップが基準。外周8px、ヘッダー44px、残り高さを選択した最大6行で均等分割。ページ全体を縦スクロールさせない。列は PBI / ToDo / Doing / Wait / Done / Demo goal。横幅の大半を4つの作業列に割り当てる。右上の6点ドラッグハンドルは表示せず、カード全体のdragは維持する。初期位置では付箋4枚を2×2で完全表示。5枚目以降は同じセル内で同じ大きさの付箋が縦に続き、範囲/総数と上下操作で移動する。送り行・ボタンは高さ20pxへ抑え、左右40pxのボタン幅と明瞭なfocus・既存Page Up/Down操作を維持して付箋へ高さを戻す。別の一覧ダイアログには移さない。他列の移動先と6行の全体俯瞰を保つ。狭い画面で勝手にモバイル別製品へ変形せず横スクロールで列関係を守る。

左セルは PBI タイトル、PBI自身のcanonical担当者avatar/名前、進捗ゲージ、完了数/対象数。担当者は子Taskやauthorから推測せず、共有avatar部品で複数・未割当・画像失敗を扱う。Demo goal は本文から抽出した原文 Markdown のみ。付加説明・装飾旗・独立したゴールデータを置かない。長いゴール本文はセル内スクロールで読む。

操作バーは検索・絞り込み・表示・補助操作を一行にまとめ、同期/全画面/配色/ヘルプは慣例的なアイコンとtooltip・アクセシブル名で示す。現在のSprintと色凡例を含む2行時も全高64pxに抑え、36pxの操作targetと行間4pxを保ちながら最上段の付箋タイトル中央を覆わない。ボード寸法と操作toggle位置は変えない。常設の操作説明と取得方式の説明はヘルプ内へ移す。正常同期の状態表示は置かず、競合・失敗の説明は省かない。

ツールバーは実際の列見出し行の上半分までのポインター移動、キーボードフォーカス、操作ボタンで現れ、ボードクリックで閉じる。表示の切り替えでボードの位置を動かさない。エディターは利用者の指定に従い、右端から画面幅の88%を使うオーバーレイ。左側12%はボードの文脈を残す。本文領域を広く、担当者と Status は右側の補助列へ。ドロワー内だけスクロールする。編集・保存操作と対処が必要なエラーは本文より上へ置き、長い本文でも操作を見つけられるようにする。更新中も取得済みIssueを即座に開く。正常な同期や保存済みを常設表示しない。本文はCodeMirror 6の構文木に基づく同一面のライブ編集。非選択行は見出し・強調・リスト・リンクの記法を隠し、表・コード・添付を整形表示する。カーソル/選択範囲が入った行やブロックは原文に戻す。複数選択とIME中は記法を隠さない。16px・1.85行高を基準にし、通常の編集でMarkdown/previewタブを往復させない。通常はライブ編集一本とし、読み取り/コード/ライブの常設切替は置かない。原文確認はその他メニューとエディター内F8へ退避する。開いた直後から入力でき、背景GETでは入力を無効にしない。タイトル自体をGitHubへのリンクにし、隣の鉛筆アイコンから同じ位置・26pxのインライン入力に置き換える。Enter/blurは下書きへ反映、Escapeはそのタイトル変更だけ取消。ラベルや完了ボタンを増やさず、サーバー反映は全体の保存に限る。種別・親Issueの重複したメタデータ帯と常設の編集/再取得ボタンを置かない。IssueのOpen/Closedだけは詳細に正本の状態として小さく示す。背景クリックとEscapeは同じ閉じる処理を使い、実際の未保存差分がある時だけ破棄確認する。IME変換中は閉じない。

初回は6行と同じ列構造のスケルトンを出し「GitHubから読み込み中」と表示する。7秒以上は応答待ちを明示し、架空の進捗率は出さない。失敗は理由と再試行ボタン、空データは空状態として分ける。背景同期では既存カードを保ち、正常な同期状態は表示しない。取得時刻は診断用に保持し、エラー時のみ最新未確認であることを示す。表示中は約45秒ごと、タブ復帰・回線復帰時に確認する。入力中も同期し、変更していない項目だけリモート値を反映する。同じ項目への変更は下書きを残して選択を求める。保存中・ドラッグ・選択操作による延期は終了後に再開する。開いた詳細や一覧も同期し、対象が範囲外になった場合は前回表示であることを明示して保存を止め、下書きは保持する。aria-busy/liveとreduced-motionに対応する。

初期表示では、公開状態をその場で確認した60秒以内の共有スナップショットを使う場合がある。カードは原文の完全な取得結果を表示し、「直近の取得結果・最新確認中」と元の取得時刻・経過秒数を明示する。即時に正本を再取得し、入力は即時可能だが、保存はfresh取得で差分を照合してから送信する。dragは最新確認まで無効。再確認失敗は失敗表示と再試行を残す。公開範囲が非公開になったと判明した場合は保持表示をやめる。スケルトンを実データ表示の計測に数えない。

Demo goalの上下paddingは全対象画面で6px、横12px。上寄せし、余った高さを整数行で使う。本文フォントは従来の12px/15pxを縮小せず、長文はcell内scrollで全文へ到達する。

## Elevation & Depth

通常のボードは1pxの境界で区別する。付箋の影はごく薄く、テキストより目立たせない。操作パネルとドロワーのみ影を持つ。ダイアログの背景は弱い暗幕とし、元のボードとの位置関係が分かる。

## Shapes

付箋は `{rounded.sm}`、通常のボタンと入力は `{rounded.md}`、ドロワーの左隅は `{rounded.lg}`。ピル形状は小さなカウントとアバターに限定。装飾目的の有機形状やグラデーションを加えない。

## Components

YAML padding は単一Dimension。横方向はボタン・入力12px、カード7pxを実装上の補正として用い、縦方向は各トークンの8px・5pxを基準にする。

PBI 選択は検索・最大6件・適用・キャンセルの明示的なフロー。選択はブラウザー内、順序は取得元の順序。Priority を取得していないときに Priority 順と断言しない。

カードと PBI はどちらも Issue エディターを開く。閲覧、編集、保存中、競合、部分保存、結果不明、再取得失敗を区別する。未保存の変更を静かに捨てない。送信済み保存はIssue IDとrequest IDに紐づけ、ドロワーを閉じても継続する。閉じる操作は同期的にmodalを解除し、別Issueを開ける。同Issueの保存は1件ずつ。担当者・Status・Story pointsの選択はその項目だけ自動保存し、本文・タイトルを便乗送信しない。離散選択の先頭200msはローカルでまとめ、値を元に戻した場合は送信しない。送信中の離散項目の変更は最新の明示選択を集約し、先行成功の正規revisionで続ける。送信済みの完了→Closeは取消さず、後続の未完了Statusで自動reopenしない。失敗・競合・結果不明では後続を停止して下書きを保持する。本文・タイトルは明示保存のまま、自動再送はしない。別Issueの保存は独立し、古い応答は現在の下書きを上書きしない。失敗はドロワー外にも復元導線を残す。ブラウザー自体を閉じた後の完了は保証しない。競合・結果不明は自動再送せず、最新状態を読み直して利用者が次の変更を決める。エラーは消えるトーストだけに依存せずエディターに残す。本文・タイトルの保存は明示ボタンまたは⌘/Ctrl+Enter。正常同期の状態バッジは置かず、保存ボタンの有効状態と送信操作への短い処理中表示だけを使う。結果不明時は確認操作を出す。永続的な未確定書き込みは通常のGETで解除しない。

コメントは本文下の独立領域で軽い3行スケルトン、読み込み・空・失敗を区別する。 コメント本文の全blockを共通の最大100chの読み幅へ揃え、段落だけを狭めない。list/quoteの意味上の字下げ、code/tableの横scroll、mediaの枠内収容は維持する。Markdownのsoft改行は自然な折返し、明示hardbreakはそのままとし、原文やparserは変更しない。本文の表示はコメントを待たない。権限キャッシュを使わず、対象Issueの正式所属だけを毎回検証する。GitHub上の作者/アバター/時刻/リンクを保ち、投稿はGitHub App名義で匿名URL利用者が行えることを常時明示。コメント下書きはIssue本文保存と独立し、結果不明では再投稿を止める。
コメント投稿は接続元・Issue・request ID・送信本文のsnapshotに所属し、POST中も×/Escapeで閉じ、別Issueを開ける。送信中は同Issueのコメント入力だけを止める。閉じても送信済み意図・失敗本文・結果不明の停止状態はメモリで保持し、別Issueの下書きへ結果を混ぜない。既知失敗は明示再操作のみ、結果不明は再投稿を止める。未送信の通常下書きだけは既存の破棄確認を行う。未解決の背景投稿もページ離脱時に警告する。公開失効・接続元変更で下書きと旧応答の所有権を破棄し、同一接続元の公開失効は表示中Issueに関係なく即時消去する。
コメント一覧は初回1ページのみ。追加で開いたページ範囲だけを更新時に再取得し、同じ接続元のコメントGETを最大2件並列に制限する。全必要ページの成功後に一覧・次ページ・取得時刻を一括採用し、部分失敗では従前の一覧を保つ。同じID・本文のDOM、本文/コメントの選択や下書きを再生成しない。POST成功後の再取得は背景で行い、取得中の追加成功は同Issue表示セッションの再取得1件へまとめ、閉じる/切替後の古い一覧応答は表示へ戻さない。投稿時内容は同Issueで最大10件保持し、canonical GETでIDを一度観測したら通常一覧へ統合する。その後の外部編集・削除は再取得で反映する。未観測の投稿が直後に外部削除された場合とGET未反映は区別できないため、それまでは「投稿時の内容」と表示し、現在存在を断定しない。一覧更新を理由にPOSTを自動再送しない。

メディアは安全なGitHub添付のみ。画像はdialog内の表示位置から200px以内で遅延読み込み。動画/種別未確定添付は150px近傍で自動判定し、pausedな先頭画面を表示する。自動playは禁止。未知/動画previewは同時1、12秒でfallback。元リンクを常に残す。16:9の最大480pxコンテナは仮の安定領域であり実寸を主張しない。画像はcontainで全体を表示し、本文・コメント取得はメディア通信を待たない。同じコメントID・本文の再取得では媒体DOMを保持し、作者等の変更はヘッダーだけ更新する。画像の監視はDOM接続後にdialog単位で共有し、同時取得を3件までに抑える。45秒応答しない画像は失敗表示と元リンクへ戻す。閉じる/切替で再生・監視・待機画像を解除し、破棄中に次の待機要求を開始しない。closingアニメーションでlive widgetの接続が残っても、閉じた/閉じかけのdialogではqueueを取消し、新規監視を始めない。画像bytesを独自キャッシュせず、HTTPキャッシュはブラウザーに委ねる。

修飾なしFキーで全画面切替。入力・IME・dialog内・リピートでは実行しない。フォーカスリングは3px。Escape はダイアログを閉じるが、未保存の確認を経由する。Tab はネイティブ dialog 内に留まり、閉じると起点へ戻る。ドラッグ以外に Status セレクトから同じ操作ができる。アニメーションは180ms程度、reduced-motion で停止する。

本文左上はGitHub正本の作者avatarと名前/login。担当者とは別属性。担当者は検索サジェストを置かず、実候補と現在割当のavatarタイルから複数選ぶ。選択はcheckと青い境界、未選択は中立境界。氏名のellipsisにはtooltip、画像失敗は頭文字fallback。通常の6候補は2列で見渡せる。

Statusは原語名と14pxの色輪郭（2px）＋12%色を混ぜた淡い内側の選択肢。選択はneutral面とcheckで示す。列見出しも同じ14pxの輪郭＋淡い内側と、白surface・input-border・7px角丸の共通status-chipを使う。詳細側を基準とし、列は既存高さを保つため上下4pxのコンパクトなラベルにする。列ラベルにボタン/選択の意味は付けず、件数は従来どおり右端。両者は同じstatus-* tokenを使う。Projectのcolor enumをgray #57606A / blue #0969DA / green #1A7F37 / yellow #9A6700 / orange #BC4C00 / red #CF222E / purple #8250DF / pink #BF3989へ写像する。白との比は6.39/5.19/5.08/4.87/5.03/5.36/5.05/5.05。文字は通常inkで、色だけに依存しない。列見出しはToDo=未整理、Doing=作業中、Wait=レビュー中、Done=完了の代表色。type付箋面は変更しない。未知colorはneutral gray。

進捗は40件まで1task=1segment、完了数だけ塗り、数字を残す。0件は空のtrack、41件以上は極細目盛りを偽って並べず連続バー＋正確な数値へ戻しtooltip/ariaで多数のため連続表示と伝える。分母や完了判定は従来どおり。最新指定により進捗完了色は青のprogress-completeとし、Statusの完了greenとは別の意味にする。GitHub Projectsの見慣れた表現を優先する。参考画像の8px程度のflatな帯を3px間隔で分割し、全体の左右端を丸く、内部の区切りは直線にする。paddingは0、trackは透明（0件はprogress-track）、未完了はprogress-pending、完了はprogress-complete。skeuomorphicな溝・inset・shadow・gradientは使わない。パーセント表示は加えない。数字はtabular-numsで右揃え。

常設B/見出し/リスト/コードの書式列は削除。作者行右側にはその他メニューのみ置き、必要時の原文確認へ入る。Markdown直入力、⌘/Ctrl+B・I・Shift+H・Shift+L・EとUndo/Redo/保存を利用でき、IME中は書式変更しない。

mermaid fenceは近傍でWorker描画し、通常は図、選択/鉛筆では原文。Fitと拡大縮小、拡大後の明示dragを用意。図のcanvasはoverflow:hiddenでホイール対象にせず、overscrollを封じない。通常wheelは本文へ自然に流し、図のscale/位置を変えない。Cmd/Ctrlのブラウザーzoomも横取りしない。図の外部画像/リンクは無効、エラーと元コードはその図の中に収める。詳細な安全上限はADR008を参照。

## Do's and Don'ts

- 原文・アバター・状態の意味を維持する。色だけで情報を伝えない。
- 最初の4枚を必ず見せ、残りを件数で明示する。
- 保存結果を GitHub から確認し、失敗・競合・更新時刻を正直に表示する。
- Project StatusとIssue stateは独立した正本。白板の明示操作でStatusを完了へ変更した時、または詳細の「Issueをクローズ」を押した時に、その対象IssueをcompletedとしてCloseする。後者はProject Statusを変更しない。既にclosedなら状態は変更しない。未完了へ戻しても自動Reopenしない。親子への連鎖や既存Doneの一括処理はしない。見送りを完了に数えない。
- 白い作業面を基本に、長文の可読性とキーボード操作を実機サイズで検証する。
- 宣伝ページ、サイドナビ常設、意味のないカード列、ダミーの実績値を追加しない。

配色検証（ライト）: ink/白14.18:1、muted/白7.58:1、accent/白6.17:1、progress-complete/pending3.92:1、操作境界/白3.36:1。focusの青はtype黄/青上で4.69/3.66:1。構造lineは装飾の区切りであり単独の操作境界にしない。旧--green名は--accentへ改称し、drag-over/選択/入力/トースト/欠損avatarもsemantic rolesを使う。Status greenとtype色は保持。

入力境界はtoolbar/detail-dialogの高詳細度ルールにもinput-borderを適用する。小avatarの画像失敗時はavatar-fallback-bg/ink（selected面とink）で頭文字を表示し、旧緑＋白文字は使わない。

タイトルのインライン入力は三辺透明＋下線の構成を維持し、その下線にinput-borderを適用する。focus outlineは青で表示する。

GitHubの既知の視覚表現で認知負荷を下げ、操作はチーム向けに改善する。全面コピーはしない。担当者は現在の候補一覧＋avatarタイルを維持し、不特定ユーザー検索に戻さない。候補外の既存担当者や未編集値は勝手に削除しない。

担当者の選択checkはタイル内の右上2px、13pxの円に収め、負のoffsetを使わない。名前の右余白を確保し、候補grid内4pxの余白で最上段/端のfocus ringも切らない。

通常のclean/syncing/savedは文章・バッジ・toast・live regionで通知しない。正常な入力・選択は背景GETや保存POST中にも続けられ、送信後の下書きを保持する。明示保存ボタンの有効状態・処理中の短い表示、変更破棄とdirty-close確認は残す。エラー/競合/結果不明/オフライン等の対処が必要な時だけ理由と回復操作を示す。初回空画面や媒体のskeletonは別用途として維持。本文・タイトル・コメントの送信意図は維持し、離散項目だけは選択時に自動保存する。

関連PRはタイトル下・本文上の文脈欄に、状態アイコン＋#番号＋タイトルの丸いリンクで置く。GitHubの正式なclosing/manual linkのみ、固定repoの公開PRのみを扱い、新しいタブで開く。本文とは独立して取得し、空は欄を隠し、取得不可には再試行を示す。open/draft/merged/closed-unmergedを区別し、StatusやIssue完了判定へ混入させない。

アイコンは[GitHub Octicons](https://primer.style/octicons/) 19.42.0（MIT）をビルド時に必要16個だけ抽出する。Lucideのvanilla/tree-shakingも比較したが、今回のGitHub慣例とPR状態表現に合うOcticonsを選ぶ。人気を無欠陥の保証とはしない。runtime CDN/React移行/全icon bundleは不要。共通Iconは16px viewBox・fill currentColor、IconButtonは32px以上、Kbdは22px四方・同一line-height。Macは⌘/Return、その他はCtrl/Enter。更新時もSVGを文字に置換せず、button-local busyと回転（reduced-motionで停止）、disabled、accessible nameを保つ。

限定disclosure: parse5 8.0.1（MIT）の非DOMパーサーとLezerのコード範囲で、対応するdetails終端まで抽出する。native details/summaryを新規生成し、元属性はopen真偽だけ移す。summaryは安全なplain text（強調等は文字だけ）、内部は開いた時に既存Markdown/media/diagramルートで描画する。閉じた本文はstringのまま、閉じると媒体/図を破棄する。明示openは初期展開。欠けたsummary/終端、過度なネスト（4段階）/件数（20）は原文fallback。汎用HTMLの許可範囲を増やさず、style/on*/id/name/form/iframeや外部callbackを通さない。raw Markdownは変更せず、toggleだけでdirtyにならない。

ライブ内リンクは通常クリックで編集、MacはCmd+click、その他はCtrl+clickで安全なHTTP(S) URLを新タブへ開く。hover/カーソル時に小さな開くリンクを出し、修飾キーを知らなくても操作可能にする。URLは構文木とMarkdown参照定義から解決し、code/画像/危険protocolでは移動しない。raw・undoを変更しない。

操作tooltipはFloating UI DOM 1.8.0（MIT）のcomputePosition/autoUpdateで配置。hover/focus開始に待ち時間を設けず、濃い中立面と白文字のcompact表示。triggerとtooltip間の120ms close猶予でpointer移動を許し、tooltip上で保持する。aria-describedbyと独立したaccessible name、Escape dismiss、新hover/focus周期まで再表示抑制、scroll/click/close cleanupを共通化。native titleは同じ操作要素から除去する。F8は本文/補助操作内のみ、IME・修飾キー・repeat・closing時は無効。既存保存と全画面shortcutは不変。

限定HTMLの耐入力性: details深さ4/件数20に加え、全HTMLノード深さ64・2000個を上限に反復走査し、深いdivやsummaryでも再帰stackを消費せず原文fallbackにする。

セル内付箋の位置はセッション内のみ保持。描画済みscope・検索/担当filter・PBI ID・列のkeyで記録し、詳細から戻る時、同期、resizeでも実際に可視範囲と交差する付箋IDと上端offsetをanchorとして復元する。4枚pageの先頭ではなく中間scroll位置も保持する。消えた場合は同時に見えていた同セルの生存ID、次いで旧位置を範囲内に収める。Status移動後は現在の列の同Issueへfocusを戻す。 ドラッグ保存はIssue単位に所属し、別IssueはPOST待機中でも続けて移動できる。同Issueの投稿中だけdragを止め、保存中のcursorとaria-busy・アクセシブル名で伝える。付箋tooltipは出さない。canonical ACK後は全体GETの終了を待たず再操作でき、次の保存はそのACKのrevision/fingerprint/statusを基準にする。 明示的なSprint表示範囲の切替中だけはdragを一時停止し、表示と送信範囲を一致させる。 通常再取得も採用済みの表示選択を明示し、破棄された切替応答が次の範囲を変えない。失敗時は対象の楽観Statusだけを戻して下書きと結果確認導線を保持し、別Issueを止めず自動再送しない。Doneの結果不明・部分失敗の個別確認契約は変えない。GETは読み取り専用のlockと世代で管理し、楽観移動より古い応答や保存中の上書きを捨てる。別IssueのACKやGETで進行中のnative dragのDOMを置換せず、終了後に一度描画する。ただし公開失効は即時消去する。位置のためにfilterを解除しない。Page Up/Downとキーボードでの上下操作は、表示した先頭付箋へfocusを移しEnterで詳細を開ける。上下ボタン/Page Up/Downにより、長タイトルの内部scroll以外からも続きを操作できる。通常wheelはnative scroll/chaining、drag近傍auto-scrollは同PBIの有効な移動先だけ。4枚以下は従来の配置を保つ。

PBI自身のStory pointsは任意の後読込情報。担当者行の右端と詳細サイド欄に小さな`0.1`等の数字だけを表示し、ink/selected/lineを共有する。11px・16px行高・4px角丸で、警告色や強調順位を値で変えない。8/13も正常値。未設定・非公開・未接続・取得失敗は空欄とし、placeholder、警告、必須チェックを追加しない。Taskからの合算や推測はしない。追加応答はバッジだけ更新し、タイトル・担当者・ゲージ・セルscroll・編集中の原文を再構築しない。初回表示や詳細を待たせない。詳細サイド欄ではStory pointsのラベルと0.1/1/2/3/5/8/13・解除を選べる。値の確認前は編集欄を出さない。選択したポイントだけを自動保存patchへ含め、本文・タイトルを便乗送信せず、既存の未知数値を未操作で消さない。canonical org field 49067031のみを更新し、公開定義を保存前後に確認する。Appの権限が不足する場合は機能を省略し、ボード本体を止めない。

保存失敗の下書きが現在のmilestone/filter外になった場合、filterを変更せず、画面外の復元導線から読み取り専用の原文と選択値を確認・コピーできる。既知の非公開化では保存entryごと消去し、復活させない。送信中・未解決entryはページ終了警告の対象とし、確認済み成功だけなら警告しない。カード移動の失敗は対象Issueの変更fieldだけ戻し、他Issueの確認済み保存結果を全snapshotで巻き戻さない。

完了操作はStatusだけでなく対象IssueのClosed到達までを保存意図として保持する。Status成功・Close既知失敗は再取得で黙って成功扱いせず、明示的な「完了処理を再試行」を出す。状態差分がなくてもこの操作はstatus=完了を送る。結果不明・永続fenceはGET成功で解除しない。既にDone/Closedが確認できた既知失敗は重複Closeしない。

Story points後読込の整合性: 同じ公開scope・同じPBI集合の再取得中は確認済み値を保持し、stateオブジェクトの置換だけで消さない。完了応答は要求集合単位の置換として扱い、数値/null/キー欠落を区別する。欠落・失敗を古い数値で隠さず、空projectionは公開field失効の可能性として全消去。保存ackは対象PBIの世代だけ進め、先行GETのそのPBIの古値だけ拒否し、他PBIの結果は受け取る。確認済み保存直後のboard読取では、全対象の値が既知かつ45秒未満なら重複SP要求を省く。通常poll/focus、scope/集合変更、未取得・期限超過では改めて確認する。進行中の同scope要求は共有し、初回boardや本文を待たせない。

ヘルプは「選ぶ変更と、書く変更」「列とステータス」「Demo goalを直したいとき」の3項目に限定する。見出し、太字、短い対応表と余白で強弱を付け、最大PBI数・全画面F・Escape等の既存UIから分かる説明は繰り返さない。機能やshortcutは削除しない。内部構造・宣伝・正常同期状態を常設説明しない。

公開field失効の空応答は読取世代も進める。失効前に送信した保存の遅いackは値を再投入できず、値が未確認の後続Story points保存はPOST前に停止する。正常な保存結果自体と、現在その値を公開表示できることを分離する。

初回Story pointsは、type:PBIの通常ビューではProjectのPBI queryへ同梱する。Project独自のnumberではなく、linked `ProjectV2ItemIssueFieldValue.issueFieldValue`を参照し、正本Issue field/PVTF ID・NUMBER・ALLを開始/終了に確認する。本文/担当/Statusと同じboard応答から数字を表示し、追加の全PBI後読込を要求しない。共有snapshotにもfieldの公開性をguard keyへ含め、失効時に古い数字を再利用しない。型不正・欠落は未設定と区別して省略、正規field確認下のnullだけ未設定とする。通常経路以外の既存fallbackは後読込契約を保持。任意fieldのGraphQL schema/権限エラーは、その値を含まないbase queryへ戻してboard自体を維持する。

同梱SPの共有snapshotはboardと同じ元fetchedAt/最大60秒であり、最新取得済みの値と偽らない。直後のfresh boardで更新する。初期cached表示時間とfresh完了時間は運用記録で分ける。field公開性は再利用の前後にlive確認する。新しい値専用TTLや永続キャッシュは導入しない。

同梱boardの古い応答を保存世代で破棄する時も、明示的なfield公開失効/空projectionだけは優先して消去し読取世代を進める。古いboard本文・Statusは採用しない。後続のfresh GETが失敗しても、失効した値や選択肢を残さない。

## 作業見積とバーンダウン

PBI配下の非PBI Issueに任意の見積時間（h）を持つ。種類名を列挙せず正式親子関係で対象を決め、PBI自身のStory pointsと換算・合算しない。詳細はStory pointsと共通の選択ボタン（0.5 / 1 / 2 / 3 / 4 / 5 / 6 / 8 / 12h、未設定）。クリック・Space・Enterで選び、その項目だけ200ms集約autosaveする。GitHub正本は引き続き0〜1000の有限数値であり、既存の0・1.5・13等は現在値の選択肢として保持し、丸めない。未設定を0と表示しない。

ボード右端3.5%のhoverと明示ボタンから右overlayを開く。操作ボタンとツールバー内はhover対象から外し、操作の途中でチャートを開かない。ボードの寸法は変えず、Issue詳細・drag中は自動表示しない。チャートmodule/APIは表示時だけ遅延取得。赤の実線は「未完了の末端作業の見積合計」で、実消費時間ではない。未見積件数・JST観測時刻と範囲変更を小さく併記。Sprint 9は利用者が明示した2026-10-21/22/23/26/27/28の学校6日を横軸にする。学校日程はスプリント単位で調整でき、未来スプリントの平日は提案に留める。進行中Sprintの青い理想線は現在の対象全体見積から最終学校日の0へ引き、scope変更で再計算する。正式な終了境界を過ぎたSprintは、境界より前の最後の保存観測を「最終記録」と元時刻付きで表示し、青線もその記録の全体見積を参照する。繰越によるscope離脱を完了の0と見せない。終了前の記録がなければ「残り：—」「記録なし」とし、現在scopeが空でも保存済みの過去赤線を消さない。過去の赤い観測を補完・書換しない。履歴開始前は空白、取得失敗をゼロに変えない。Escape/backdropとfocus復帰を維持。詳細な正本・観測契約はdocs/BURNDOWN.md。

時間選択は本文・タイトルを便乗保存しない。本文・タイトルは従来の明示Save/Cmd/Ctrl+Enterで保存する。選択中・送信中も他の選択や詳細を閉じる操作は可能で、後続最新意図を同Issueの単一flightに直列化する。数値入力専用validation/IME処理は不要となるため除去し、本文・タイトルのIME保護を維持する。

開いているバーンダウンだけ、時間/Statusの保存確定または集計scopeの実変更で再取得する。無関係な本文/title変更・閉じたパネルでは追加要求しない。先行履歴GETがある場合は古い描画を無効化し、その応答の完了後に一度だけ新しい読取を行う。サーバーの旧singleflightへ再合流しないため、描画破棄と通信完了を区別する。

バーンダウン再訪は同スプリントの前回観測をメモリから即表示し、背後で最新確認する。通常の再読込で図を消さない。取得失敗は前回観測時刻と短いエラーを残す。公開失効・認証失効・対象scope変更ではキャッシュを消す。最大12スプリントのメモリのみ、localStorage等へ保存しない。初回boardの通信は増やさない。

完了はStatus「完了」またはIssue CLOSED/COMPLETED。ただし「見送り」またはCLOSED/NOT_PLANNEDはcancelとして対象合計から除き、完了成果に数えない。原文やGitHubの状態をチャートが変更することはない。日程変更は履歴DOの限定設定（競合revision/リクエスト識別/公開確認）で、Issue値と観測履歴は変更しない。

同じ集計・観測・日程の背景応答では図DOMを再生成せず、観測時刻だけ更新する。展開中の内訳や選択操作を通常の再取得でリセットしない。

日程の明示保存中も入力は継続できる。成功応答は送信した日程だけを確認済みにし、送信後に変更した下書きは保持する。次の明示保存は確認済みrevisionを使い、追記を自動送信しない。

日程の下書き・revision・保存中状態・エラーはスプリントごとに分離し、別スプリントへ切り替えても取り違えない。遅い保存応答は送信元だけに反映し、切替先の取得失敗でも既知の日程を保つ。赤線は隣り合う観測済み学校日だけを結び、中間の未観測学校日を線で補間しない。

バーンダウンはdesktopで右70vw、狭い画面では全幅。学校日程の入口はheader右上の閉じるボタン隣に置き、42px以上の日付を持つ小型panelで開く。下書きはpanelを閉じても保持し、保存は小さな明示ボタンで行う。Escapeは日程panel、chartの順に閉じ、日程の明示closeは入口へfocusを戻す。外click・Tabで離れた場合は新しいfocusを奪わない。操作方法や計測定義の長い説明は常設せず、理想/実際のlegend、記録なし、失敗状態は残す。登場はIssue drawerと同じtransform/opacityの動きを360ms ease-outへ調整し、reduced-motionでは即表示する。

学校日程は月表示カレンダーから1日ずつ独立して選択・解除する。範囲ドラッグや日付書式の入力は用意しない。月送り、選択数、選択チェック、明瞭なfocusとキーボード移動を備え、選択は明示保存まで下書き。未設定（空・revision 0）のスプリントで日程を初めて開いた時だけ、JSTの今日から期日までの平日を未保存候補にする。開始日が判明したと主張せず、過去/期日不明/180日超/候補60日超は空から選ぶ。祝日・休講は自動推測しない。保存済み空日程、既存のSprint9学校6日、操作済み下書きは候補で上書きしない。月と下書きはスプリント別に保ち、再open/refresh/保存中の追記を維持する。新しいcalendar moduleもバーンダウン初回表示まで読み込まない。

バーンダウンの主値は「残り：61h」の形式。「観測の内訳」の展開表は表示しないが、履歴の保管・整合性と観測時刻は維持する。操作バーの未見積強調は初期OFFの閲覧補助。公開確認済みの末端作業で見積がnullの付箋だけ、独立した1pxの静的輪郭と、利用者が比較デモで選択したA「ふわっとハロー」で示す。1.5秒 ease-in-out で全辺の光を同時に opacity 0.2→0.8→0.2 と呼吸させ、周回する小さな光は使わない。選択済みAの雰囲気を維持しつつ、より明確に目立つよう装飾を外側へ強める。静的1px cueは維持し、外側2px ringとblur14px/spread9px/accent100%のshadowを用いる。速さや文字面積は変えず、知覚的な強度が厳密に3倍になるとの保証はしない。狭い2×2では隣の紙面へ光が流入しないよう外側余白内へ制限する。overflow viewport端では外側shadowもclipされるが、細い内側の輪郭は維持し、光のために文字面積を削らない。タイトル・avatar・h・紙面は動かさず、透明な中心と外側の光だけを描く。太い内枠・白いinset・面を覆うbadgeは使わず、種類の背景色を保つ。追加library・JSの毎frame処理・全付箋へのwill-changeは不要。表示中の付箋だけ動かし、overflow外・drag中・document.hiddenではpauseし、静的cueは消さない。reduced-motionでは静止した輪郭を残す。footerの未設定欄は塗り背景のない簡潔な「未見積」textへ切り替え、UのON/OFFで文字・avatar・hのboxやpadding・layout占有を変えない。未設定というデータ状態は変えない。通常の再取得中も直前に公開確認できたnullの輪郭を保ち、取得結果・失効時に更新する。0・未取得・非公開・PBI・親作業は未見積扱いにしない。Uキーは入力/IME/dialog/修飾キー中に発火させず、reduced-motionでは静止した輪郭にする。明示的に強調をONにした時だけ、表示PBI行の付箋（隠れたoverflowページも含む）の見積対象を全て確認でき、未見積が0件なら「未見積もりのタスクは0件です」と一時表示する。読取中・古い表示・未取得・対象不明では0件を断定しない。保存・値の推定・追加API読取は行わない。

未見積motionの性能検証は同じfixture/DOMのOFFとONを6・24・94枚で比較し、実timelineの振幅、紙面pixel不変、resize、drag/画面外/非表示pauseとともにCIへ記録する。94枚はstress条件であり実利用件数の測定ではない。旧周回方式のoffset-distance/transform数値はdocs/UI-MOTION-REGRESSION.mdに履歴として残し、A方式の性能と混同しない。全端末60fps・一律高速化・実GPU合成を主張せず、確認できた環境と絶対負荷を分けて報告する。恣意的な対象間引きで強調を途切れさせない。


## 操作選択・Issue state（2026-10-28）

操作バーの担当者・Sprint・表示密度は、同じ36pxのtriggerとsurface/line/accent/softを使うselect-only comboboxへ段階的に強化する。既存selectを値とchangeの正本として残し、初回boardを追加APIやmodule完了で待たせない。候補はavatar・名前/login・checkで識別し、全担当者の選択と未割当を含む既存filter意味を変えない。閉じた候補のavatarは初回openまで読み込まない。Arrow/Home/End/typeaheadは候補だけ移動し、Enter/Spaceで確定、Escapeは取消、Tabは閉じて次へ進む。disabled候補を飛ばし、open中に候補集合が変われば閉じて誤選択を避ける。公開失効では非表示だけでなく旧候補DOMを消す。[WAI-ARIA APG select-only combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/)を参照しつつ、assistive technologyの実機全組合せを検証済みとはしない。

ページ表示は1ページ3 PBI、全体表示・PBI選択上限は6のまま。下部の前/次ボタンに加え、boardへfocusした時の左右キーと横優位のwheelで移動する。1つの慣性gestureは1ページだけ、端で循環しない。縦scroll、修飾key/zoom、入力/IME、native選択、dialog/popover、ドラッグ、内側の横scrollは横取りしない。synthetic wheel/keyの回帰と実Mac trackpadの検証は別であり、後者は未実施。

利用者がA「ふわっとハロー」を選択済みのため、比較デモの入口・遅延module/CSS・専用dialogは撤去する。本番の強調ON/OFFとUキーは維持し、選択用の恒久UIや保存データは増やさない。

詳細上端のIssue番号は16pxの文字だけのnative buttonとし、追加アイコン・説明tooltipは置かない。表示番号と一致する固定repoのcanonical Issue URLだけをクリック/Enter/Spaceでコピーする。URL未確認は無効化してariaで伝え、clipboard成功後だけ番号の横に一時的なチェックと「コピーしました」をdialog内live statusで2秒表示し、拒否時も同じ場所で失敗を伝える。常設コピーアイコンは追加せず、番号・×・見出しの位置は変えない。再クリックで表示timerを更新し、Issue切替/close/公開失効/接続変更で通知と旧完了の所有権を即消去する。古い接続元・drawer sessionの完了通知は新しいIssueへ出さず、追加APIは呼ばない。

詳細のIssue stateはboardが持つcanonical GitHub state/stateReasonのみを用い、Project Statusから推測しない。Openはgreen、Closed completedはpurple、not-planned/duplicateはneutral、未知は「状態未確認」。付箋へ状態badgeを戻さない。Open/Closed表示はheaderに残し、Openの時だけ「Issueをクローズ」を詳細最下部の左寄せ・低強調の独立行へ出す。コメント投稿とは別行で32px離し、隣接する二者択一に見せない。チェック入り円の既存Closedアイコン、淡い紫の面と枠・濃い紫の文字で、青い投稿primaryとは別の完了操作として示す。高さ36px、keyboard focusを保ち、送信中/再試行でもiconと文言を維持する。赤いdanger表現や追加アニメーション/APIは用いない。クローズ時に未保存本文・タイトル・Project Statusを便乗送信しない。既存のIssue単位保存queue/DO/request ID/revision/fingerprintと公開scope guardを通り、state/reasonもpreflight比較する。POST中は同Issueの追加closeを止めるがdrawerは閉じられる。成功のcanonical CLOSED/COMPLETEDを確認してから表示し、失敗・競合・結果不明は保持して勝手に再送しない。状態確認GETだけで未知結果のfenceを解除せず、公開失効時は古いstate DOMも消す。既存Done→close、他Issue並行保存、未見積の確認済null・0h区別は変更しない。
