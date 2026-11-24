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
  dark-issue-state-open: "#7ee787"
  dark-issue-state-completed: "#bc8cff"
  dark-issue-state-closed: "{colors.dark-muted}"
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

IdeaBoost のチームが、会議中に同じ一枚の作業面を見て状況をつかみ、その場で GitHub の実データを直すためのデスクトップホワイトボード。主役は白い作業面、Issue の原文、動かない行列。装飾や大きな見出しで作業領域を奪わない。

迷ったときは次の順で決める。

1. **正本を偽らない。** GitHub の原文・状態・値をそのまま見せ、取得できない・保存できなかったことを隠さない。推測で埋めない。
2. **一目で全体が見える。** 6 PBI の行と付箋 4 枚を一画面で俯瞰できることを、個々の情報量より優先する。
3. **操作が見つかり、キーボードで届く。** 説明を常設せず、慣例的な形とラベルで分かるようにする。
4. 見た目の好みはその後。

参考は Linear（雑音の少ない境界）、Airtable（構造化された情報と淡い色の区別）、Notion（白い紙面と本文中心）、GitHub Primer（Status の色と輪郭）。販促ページの要素（ヒーロー、ロゴ、独自フォント、暗いキャンバス、過剰な丸み）は持ち込まない。参考資料は docs/references。

値の正本は YAML。本文は用途と判断を書く。保存・同期・競合などの細かい振る舞い、計測値、経緯は [docs/UI-BEHAVIOR.md](docs/UI-BEHAVIOR.md) と docs/adr にあり、その領域を変えるときに読む。

## Colors

- **役割で選ぶ。** 背景は `canvas`、ボードと面は `surface`、本文は `ink`、補助は `muted`（これより薄くしない）。区切りは `line`、操作できる境界は `input-border`、選択中は `selected`、主操作とフォーカスは `primary`。装飾の `line` を操作の境界に使わない。
- **付箋の色は Issue type だけで決まる。** Task は黄、競合調査は青、その他・未設定は灰。Status・担当者・並び順で色を変えない。凡例とカードは同じ分類を使う。
- **Status は GitHub Project の色を `status-*` へ写し、輪郭と淡い内側で示す。** 進捗ゲージの完了は青（`progress-complete`）で、Status の「完了」の緑とは別の意味。
- **色だけで意味を伝えない。** 状態・警告・強調には必ず文字を添える。見送り・未設定・未知を完了の色や集計に混ぜない。
- 新しい色は、既存トークンで表せないかを先に考える。足すときは本文 4.5:1・操作境界 3:1 以上を確認して YAML に加え、CSS と揃える。
- ダークモードは明示的に選ぶ補助機能。ライトを先に設計・検証し、ダークは同じ役割のトークンを切り替えて読める対比を保つ。

## Typography

- OS 標準の日本語ゴシックを使い、外部フォントを読み込まない。英語向けの負の字間や細いウェイトを日本語に当てない。
- 役割は `title`・`editor`（長文の編集、16px／行高 1.85）・`body`・`card`・`label`。付箋は 6 PBI 同時俯瞰のための例外として 12px（2560 幅で 14px）とし、収まらないときだけ 11px まで縮める。11px 未満にはしない。
- **Issue のタイトルと本文は原文のまま。** 略さず、要約や番号に置き換えず、行の途中で切らない。入りきらない分はカード内のスクロールと詳細画面で全文に届くようにする。
- 見積・件数・進捗などの数字は `tabular-nums` で揃える。

## Layout

- 基準は 1920×1080 と 2560×1440 のデスクトップ。ページ全体は縦スクロールさせず、1 ページ 1〜6 行（初期 6）で高さを均等に割る。狭い画面でもモバイル用に作り替えず、横スクロールで列の関係を守る。
- 列は PBI / ToDo / Doing / Wait / Done / Demo goal。横幅の大半を 4 つの作業列に配る。
- 1 セルの付箋は 2×2 の 4 枚を完全に見せる。5 枚目以降は同じセルの中で送り、別の一覧画面へ逃がさない。
- 操作バーは普段は隠し、ボード上端へのポインター・キーボードフォーカス・操作ボタンで出す。出してもボードを動かさず、高さは 64px までに収める。
- Issue エディターなどの詳細面は右端 88% のドロワーにし、左 12% にボードの文脈を残す。スクロールはドロワーの中だけ。保存などの操作と対処が要るエラーは本文より上に置く。
- 読み込みは同じ列構造のスケルトンで示し、架空の進捗率を出さない。長く待つときは待っていると言う。正常な同期や保存済みは常時表示せず、失敗には理由と回復操作を出す。

## Elevation & Depth

ボード上の要素は 1px の境界で区別し、付箋の影はテキストより目立たせない。影を持つのは操作バー・ドロワー・ポップオーバーだけ。ダイアログの背後は弱い暗幕にし、元のボードとの位置関係が分かるようにする。

## Shapes

付箋は `rounded.sm`、ボタンと入力は `rounded.md`、ドロワーの左角は `rounded.lg`。ピル形はカウントとアバターだけ。装飾目的の有機的な形やグラデーションは加えない。

## Components

部品ごとの判断だけを書く。詳細な状態遷移は docs/UI-BEHAVIOR.md の同名の節を参照。

**ボタン・入力・アイコン**
- 主操作（`button-primary`）はその画面に 1 つ。他は surface と `input-border` の控えめなボタンにする。
- 操作の大きさは 32px 以上（操作バーは 36px）。フォーカスリングは 3px の `primary`。
- アイコンは GitHub Octicons を必要な分だけ使う。アイコンだけのボタンには、アクセシブルな名前と、待ち時間なしのツールチップを付ける。

**付箋と PBI 行**
- 付箋は type 色の面、原文タイトル、下端に担当者のアバターと見積 h。付箋にはツールチップ・type 記号・Status 文字を置かない。
- PBI 行はタイトル、PBI 自身の担当者、進捗ゲージ、完了数／対象数。担当者を子 Task や作成者から推測しない。Demo goal は本文から抜き出した原文だけを置く。
- 値が「未設定」なのか、「取れない・見せられない（—）」のかを区別する。0 と未設定を同じにしない。

**Issue エディター**
- 本文は同じ面でのライブ編集だけにし、Markdown とプレビューのタブを往復させない。原文の確認は補助メニューと F8 に退避する。
- 選ぶ変更（担当・Status・ポイント・見積）はその項目だけ自動保存し、書く変更（本文・タイトル）は明示的に保存する。2 つを混ぜて送らない。
- 閉じる操作は、実際に未保存の差分があるときだけ確認する。

**状態とクローズ**
- Status は原語の名前と status chip で示す。Issue の Open/Closed は別の正本で、Status から推測しない。
- Close は淡い紫の低強調な独立操作にし、赤い危険表現を使わない。投稿などの青い主操作と並べて二択に見せない。

**操作バーの選択**
- 担当者・Sprint・表示件数は select-only combobox（WAI-ARIA APG）で、元の select を値の正本として残す。候補はアバターと名前で見分けられるようにする。

**補助表示（未見積の強調など）**
- 閲覧補助は初期 OFF の切り替えにする。ON にしてもレイアウトと文字の面積を変えない。動きは控えめにし、reduced-motion では止めて静的な印だけ残す。

**バーンダウン**
- 右のオーバーレイで開き、開いたときだけ読み込む。赤は観測した残量、青は理想線。観測のない日を補完せず、取得失敗をゼロに見せない。正本と観測の契約は docs/BURNDOWN.md。

**会議まとめ**
- 議事録・文字起こしを、利用者が起動したときだけ AI で整理する補助機能（ADR 015）。常設パネル・通知・自動生成は置かない。
- 「決まったこと／次にやること／未決・持ち越し」の 3 列と話題カードで見せ、列は見出しの文字と上辺の色（緑／青／橙）で区別する。担当や期限は記録にあるときだけ表示し、無ければ「担当未定」と書く。
- AI の結果であることと原文へのリンクを常に添える。公開モードでは出さない。

**ヘルプとツールチップ**
- 操作説明は常設しない。ヘルプは画面から分からないことだけに絞る（今は 3 項目）。

## Do's and Don'ts

- Do: 保存の結果は GitHub から確かめ、失敗・競合・結果不明を正直に示して、利用者に判断させる。自動で再送しない。
- Do: すべての操作にキーボードで届くようにする。1 文字のショートカットは入力中・IME 変換中・ダイアログ表示中・修飾キー併用・キーリピートでは発火させない。
- Do: Escape は一番内側の層だけを閉じ、閉じたらフォーカスを起点へ戻す。
- Do: アニメーションは 180ms 前後に抑え、reduced-motion で止める。
- Do: UI を変えたら 1920×1080 と 2560×1440 の実画面で、長文・読み込み中・失敗・キーボード操作を確認する。
- Don't: 原文・アバター・状態の意味を変えない。色だけで情報を伝えない。
- Don't: 最初の 4 枚と 6 行の俯瞰を崩さない。付箋を別画面の一覧へ逃がさない。
- Don't: 正常な状態（同期済み・保存済み）を常時表示しない。宣伝、常設のサイドナビ、意味のないカード列、ダミーの数値を足さない。
- Don't: この文書に個別の計測値や経緯を書き足さない。それは docs/UI-BEHAVIOR.md・ADR・試験に置き、ここには判断だけを残す。
