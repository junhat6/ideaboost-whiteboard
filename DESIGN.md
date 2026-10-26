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
    lineHeight: 1.35
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

付箋色はGitHub Issue typeの固定対応。現在の正本にはPBI・Task・競合調査が存在する。Taskは参考画像の黄#FBDF7F、競合調査は青#9ECCFA、未知/nullは灰#E7E9EE。PBI左セルの白い面と最小構成は維持する。色はStatus・担当者・配列順から決めず、カードの短いT/調/?と実typeのtooltip・アクセシブルラベルを併用する。本文#24292FとのWCAG比は順に11.14/8.70/12.06、補助文字#374151は7.84/6.12/8.49。focus#3159C9は黄/青背景で4.69/3.66、カード境界#8A7130/#456B91/#7B8290は各背景と3.56/3.31/3.18。参照20色をそのまま増やさず、実typeに必要な二色を選んだ。Status は列名とエディターの原語で判別できる。見送り・未設定・未知の状態を Done 色や完了集計へ混入させない。警告は赤の色面に必ず具体的な文言を添える。

ダークモードは操作メニューから明示的に選ぶ補助機能。自動で白いボードを反転しない。dark 系トークンと濃い付箋色に切り替え、読めるコントラストを維持する。ライトの設計・検証を優先する。

## Typography

日本語を OS 標準のゴシックで描画し、外部フォント通信を不要にする。英語向けの負の字間や小さな薄文字を日本語タイトルに適用しない。カードは `{typography.card}`、本文は `{typography.body}`、PBI は 14–18px。2560幅ではカードを14pxへ広げる。

Issue タイトルは原文。勝手な略称、要約、番号への置き換えをしない。限られたカード領域では完全な行単位で表示し、長文はカード内スクロールとクリック先の全文で読めるようにする。部分的な行や文字を切らない。担当者名のみ省略可能で、アバターと名前の全文アクセシブルラベルを持たせる。

## Layout

1920×1080 と 2560×1440 のデスクトップが基準。外周8px、ヘッダー44px、残り高さを選択した最大6行で均等分割。ページ全体を縦スクロールさせない。列は PBI / ToDo / Doing / Wait / Done / Demo goal。横幅の大半を4つの作業列に割り当てる。右上の6点ドラッグハンドルは表示せず、カード全体のdragは維持する。カードは最大4枚を2×2、5枚目以降は明示した残件数から一覧へ。狭い画面で勝手にモバイル別製品へ変形せず横スクロールで列関係を守る。

左セルは PBI タイトル、進捗ゲージ、完了数/対象数のみ。Demo goal は本文から抽出した原文 Markdown のみ。付加説明・装飾旗・独立したゴールデータを置かない。長いゴール本文はセル内スクロールで読む。

操作バーは検索・絞り込み・表示・補助操作を一行にまとめ、同期/全画面/配色/ヘルプは慣例的なアイコンとtooltip・アクセシブル名で示す。常設の操作説明と取得方式の説明はヘルプ内へ移す。通常の詳細同期状態は短いラベルにし、競合・失敗の説明は省かない。

ツールバーは実際の列見出し行の上半分までのポインター移動、キーボードフォーカス、操作ボタンで現れ、ボードクリックで閉じる。表示の切り替えでボードの位置を動かさない。エディターは利用者の指定に従い、右端から画面幅の88%を使うオーバーレイ。左側12%はボードの文脈を残す。本文領域を広く、担当者と Status は右側の補助列へ。ドロワー内だけスクロールする。編集・保存操作と最新確認中の表示は本文より上へ置き、長い本文でも操作を見つけられるようにする。更新中も取得済みIssueを即座に開き、最新確認中の表示を添える。本文はCodeMirror 6の構文木に基づく同一面のライブ編集。非選択行は見出し・強調・リスト・リンクの記法を隠し、表・コード・添付を整形表示する。カーソル/選択範囲が入った行やブロックは原文に戻す。複数選択とIME中は記法を隠さない。16px・1.85行高を基準にし、通常の編集でMarkdown/previewタブを往復させない。補助操作は原文切替と読み取り表示の小さなアイコンだけにする。開いた直後から入力でき、背景GETでは入力を無効にしない。タイトル自体をGitHubへのリンクにし、隣の鉛筆アイコンから同じ位置・26pxのインライン入力に置き換える。Enter/blurは下書きへ反映、Escapeはそのタイトル変更だけ取消。ラベルや完了ボタンを増やさず、サーバー反映は全体の保存に限る。状態・種別・親Issueの重複したメタデータ帯と常設の編集/再取得ボタンを置かない。背景クリックとEscapeは同じ閉じる処理を使い、実際の未保存差分がある時だけ破棄確認する。IME変換中は閉じない。

初回は6行と同じ列構造のスケルトンを出し「GitHubから読み込み中」と表示する。7秒以上は応答待ちを明示し、架空の進捗率は出さない。失敗は理由と再試行ボタン、空データは空状態として分ける。背景同期では既存カードを保ち、同期中・最終成功時刻を示す。表示中は約45秒ごと、タブ復帰・回線復帰時に確認する。入力中も同期し、変更していない項目だけリモート値を反映する。同じ項目への変更は下書きを残して選択を求める。保存中・ドラッグ・選択操作による延期は終了後に再開する。開いた詳細や一覧も同期し、対象が範囲外になった場合は前回表示であることを明示して保存を止め、下書きは保持する。aria-busy/liveとreduced-motionに対応する。

初期表示では、公開状態をその場で確認した60秒以内の共有スナップショットを使う場合がある。カードは原文の完全な取得結果を表示し、「直近の取得結果・最新確認中」と元の取得時刻・経過秒数を明示する。即時に正本を再取得し、入力は即時可能だが、保存はfresh取得で差分を照合してから送信する。dragは最新確認まで無効。再確認失敗は失敗表示と再試行を残す。公開範囲が非公開になったと判明した場合は保持表示をやめる。スケルトンを実データ表示の計測に数えない。

Demo goalの上下paddingは全対象画面で6px、横12px。上寄せし、余った高さを整数行で使う。本文フォントは従来の12px/15pxを縮小せず、長文はcell内scrollで全文へ到達する。

## Elevation & Depth

通常のボードは1pxの境界で区別する。付箋の影はごく薄く、テキストより目立たせない。操作パネルとドロワーのみ影を持つ。ダイアログの背景は弱い暗幕とし、元のボードとの位置関係が分かる。

## Shapes

付箋は `{rounded.sm}`、通常のボタンと入力は `{rounded.md}`、ドロワーの左隅は `{rounded.lg}`。ピル形状は小さなカウントとアバターに限定。装飾目的の有機形状やグラデーションを加えない。

## Components

YAML padding は単一Dimension。横方向はボタン・入力12px、カード7pxを実装上の補正として用い、縦方向は各トークンの8px・5pxを基準にする。

PBI 選択は検索・最大6件・適用・キャンセルの明示的なフロー。選択はブラウザー内、順序は取得元の順序。Priority を取得していないときに Priority 順と断言しない。

カードと PBI はどちらも Issue エディターを開く。閲覧、編集、保存中、競合、部分保存、結果不明、再取得失敗を区別する。未保存の変更を静かに捨てない。保存送信中に別 Issue へ飛ばない。読み取り中は閉じることができる。競合・結果不明は自動再送せず、最新状態を読み直して利用者が次の変更を決める。エラーは消えるトーストだけに依存せずエディターに残す。保存は明示ボタンまたは⌘/Ctrl+Enter。通常は未保存/確認中/保存中/保存済みの短い表示に留め、結果不明時だけ確認操作を出す。永続的な未確定書き込みは通常のGETで解除しない。

コメントは本文下の独立領域で軽い3行スケルトン、読み込み・空・失敗を区別する。本文の表示はコメントを待たない。権限キャッシュを使わず、対象Issueの正式所属だけを毎回検証する。GitHub上の作者/アバター/時刻/リンクを保ち、投稿はGitHub App名義で匿名URL利用者が行えることを常時明示。コメント下書きはIssue本文保存と独立し、結果不明では再投稿を止める。

メディアは安全なGitHub添付のみ。画像はdialog内の表示位置から200px以内で遅延読み込み。動画/種別未確定添付は150px近傍で自動判定し、pausedな先頭画面を表示する。自動playは禁止。未知/動画previewは同時1、12秒でfallback。元リンクを常に残す。16:9の最大480pxコンテナは仮の安定領域であり実寸を主張しない。画像はcontainで全体を表示し、本文・コメント取得はメディア通信を待たない。同じコメントID・本文の再取得では媒体DOMを保持し、作者等の変更はヘッダーだけ更新する。画像の監視はDOM接続後にdialog単位で共有し、同時取得を3件までに抑える。45秒応答しない画像は失敗表示と元リンクへ戻す。閉じる/切替で再生・監視・待機画像を解除し、破棄中に次の待機要求を開始しない。closingアニメーションでlive widgetの接続が残っても、閉じた/閉じかけのdialogではqueueを取消し、新規監視を始めない。画像bytesを独自キャッシュせず、HTTPキャッシュはブラウザーに委ねる。

修飾なしFキーで全画面切替。入力・IME・dialog内・リピートでは実行しない。フォーカスリングは3px。Escape はダイアログを閉じるが、未保存の確認を経由する。Tab はネイティブ dialog 内に留まり、閉じると起点へ戻る。ドラッグ以外に Status セレクトから同じ操作ができる。アニメーションは180ms程度、reduced-motion で停止する。

本文左上はGitHub正本の作者avatarと名前/login。担当者とは別属性。担当者は検索サジェストを置かず、実候補と現在割当のavatarタイルから複数選ぶ。選択はcheckと青い境界、未選択は中立境界。氏名のellipsisにはtooltip、画像失敗は頭文字fallback。通常の6候補は2列で見渡せる。

Statusは原語名と14pxの色輪郭（2px）＋12%色を混ぜた淡い内側の選択肢。選択はneutral面とcheckで示す。列は小さな塗り点を維持し、両者は同じstatus-* tokenを使う。Projectのcolor enumをgray #57606A / blue #0969DA / green #1A7F37 / yellow #9A6700 / orange #BC4C00 / red #CF222E / purple #8250DF / pink #BF3989へ写像する。白との比は6.39/5.19/5.08/4.87/5.03/5.36/5.05/5.05。文字は通常inkで、色だけに依存しない。列見出しはToDo=未整理、Doing=作業中、Wait=レビュー中、Done=完了の代表色。type付箋面は変更しない。未知colorはneutral gray。

進捗は40件まで1task=1segment、完了数だけ塗り、数字を残す。0件は空のtrack、41件以上は極細目盛りを偽って並べず連続バー＋正確な数値へ戻しtooltip/ariaで多数のため連続表示と伝える。分母や完了判定は従来どおり。最新指定により進捗完了色は青のprogress-completeとし、Statusの完了greenとは別の意味にする。12pxの薄い共通trackに2px内余白、3px間隔、2px角丸の目盛りを揃える。未完了はprogress-pending、完了はprogress-completeの塗り。影は1px程度の内側の明暗だけで、派手なgradientや浮いたshadowを使わない。数字はtabular-numsで右揃え。

常設B/見出し/リスト/コードの書式列は削除。原文/読み取り表示だけ作者行右側の小さなアイコンへ。Markdown直入力、⌘/Ctrl+B・I・Shift+H・Shift+L・EとUndo/Redo/保存を利用でき、IME中は書式変更しない。

mermaid fenceは近傍でWorker描画し、通常は図、選択/鉛筆では原文。Fitと拡大縮小、拡大後の明示dragを用意。図のcanvasはoverflow:hiddenでホイール対象にせず、overscrollを封じない。通常wheelは本文へ自然に流し、図のscale/位置を変えない。Cmd/Ctrlのブラウザーzoomも横取りしない。図の外部画像/リンクは無効、エラーと元コードはその図の中に収める。詳細な安全上限はADR008を参照。

## Do's and Don'ts

- 原文・アバター・状態の意味を維持する。色だけで情報を伝えない。
- 最初の4枚を必ず見せ、残りを件数で明示する。
- 保存結果を GitHub から確認し、失敗・競合・更新時刻を正直に表示する。
- 完了と Issue の close を同義としない。見送りを完了に数えない。
- 白い作業面を基本に、長文の可読性とキーボード操作を実機サイズで検証する。
- 宣伝ページ、サイドナビ常設、意味のないカード列、ダミーの実績値を追加しない。

配色検証（ライト）: ink/白14.18:1、muted/白7.58:1、accent/白6.17:1、progress-complete/pending3.92:1、操作境界/白3.36:1。focusの青はtype黄/青上で4.69/3.66:1。構造lineは装飾の区切りであり単独の操作境界にしない。旧--green名は--accentへ改称し、drag-over/選択/入力/トースト/欠損avatarもsemantic rolesを使う。Status greenとtype色は保持。
