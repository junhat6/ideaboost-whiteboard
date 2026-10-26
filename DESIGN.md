---
version: alpha
name: IdeaBoost Team Whiteboard
description: 白い作業面で日本語Issueとチームの進行を俯瞰する、静かで正確なデスクトップホワイトボード。
colors:
  canvas: "#f7f8fa"
  surface: "#ffffff"
  surface-soft: "#f3f4f6"
  ink: "#20252b"
  muted: "#5c6470"
  line: "#d9dee5"
  primary: "#4657b8"
  primary-hover: "#354594"
  on-primary: "#ffffff"
  todo: "#626c7a"
  doing: "#946300"
  wait: "#77529e"
  done: "#27735c"
  note-yellow: "#fff7da"
  note-blue: "#eaf2fc"
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
    textColor: "{colors.ink}"
    typography: "{typography.card}"
    rounded: "{rounded.sm}"
    padding: 5px
  issue-drawer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
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

本ファイルは Google DESIGN.md alpha の YAML トークンと順序付き本文に従う。値の正本は YAML、用途と例外は本文。参照資料と取得手順は docs/references に保存する。

## Colors

既定はライトモード。キャンバスは `{colors.canvas}`、ボード・エディターは `{colors.surface}`、本文は `{colors.ink}`。補助テキストも `{colors.muted}` より薄くしない。フォーカスと主操作は `{colors.primary}` に統一する。

付箋の淡い四色はタスクの識別補助であり、状態の意味を担わない。Status は列名とエディターの原語で判別できる。見送り・未設定・未知の状態を Done 色や完了集計へ混入させない。警告は赤の色面に必ず具体的な文言を添える。

ダークモードは操作メニューから明示的に選ぶ補助機能。自動で白いボードを反転しない。dark 系トークンと濃い付箋色に切り替え、読めるコントラストを維持する。ライトの設計・検証を優先する。

## Typography

日本語を OS 標準のゴシックで描画し、外部フォント通信を不要にする。英語向けの負の字間や小さな薄文字を日本語タイトルに適用しない。カードは `{typography.card}`、本文は `{typography.body}`、PBI は 14–18px。2560幅ではカードを14pxへ広げる。

Issue タイトルは原文。勝手な略称、要約、番号への置き換えをしない。限られたカード領域では完全な行単位で表示し、長文はカード内スクロールとクリック先の全文で読めるようにする。部分的な行や文字を切らない。担当者名のみ省略可能で、アバターと名前の全文アクセシブルラベルを持たせる。

## Layout

1920×1080 と 2560×1440 のデスクトップが基準。外周8px、ヘッダー44px、残り高さを選択した最大6行で均等分割。ページ全体を縦スクロールさせない。列は PBI / ToDo / Doing / Wait / Done / Demo goal。横幅の大半を4つの作業列に割り当てる。カードは最大4枚を2×2、5枚目以降は明示した残件数から一覧へ。狭い画面で勝手にモバイル別製品へ変形せず横スクロールで列関係を守る。

左セルは PBI タイトル、進捗ゲージ、完了数/対象数のみ。Demo goal は本文から抽出した原文 Markdown のみ。付加説明・装飾旗・独立したゴールデータを置かない。長いゴール本文はセル内スクロールで読む。

ツールバーは上端へのポインター移動、キーボードフォーカス、操作ボタンで現れ、ボードクリックで閉じる。表示の切り替えでボードの位置を動かさない。エディターは利用者の指定に従い、右端から画面幅の80%を使うオーバーレイ。左側20%はボードの文脈を残す。本文領域を広く、担当者と Status は右側の補助列へ。ドロワー内だけスクロールする。編集・保存操作と最新確認中の表示は本文より上へ置き、長い本文でも操作を見つけられるようにする。更新中も取得済みIssueを即座に開き、最新確認中の表示を添える。更新完了まで編集は無効とし、失敗時は前回取得内容であることを示す。背景クリックとEscapeは同じ閉じる処理を使い、編集中は破棄確認を行う。

初回は6行と同じ列構造のスケルトンを出し「GitHubから読み込み中」と表示する。7秒以上は応答待ちを明示し、架空の進捗率は出さない。失敗は理由と再試行ボタン、空データは空状態として分ける。背景同期では既存カードを保ち、同期中・最終成功時刻を示す。表示中は約45秒ごと、タブ復帰・回線復帰時に確認する。編集中は同期を止める旨を詳細画面に示し、延期した同期は操作終了後に再開する。開いた詳細や一覧も同期し、対象が範囲外になった場合は前回表示であることを明示して編集を止める。aria-busy/liveとreduced-motionに対応する。

## Elevation & Depth

通常のボードは1pxの境界で区別する。付箋の影はごく薄く、テキストより目立たせない。操作パネルとドロワーのみ影を持つ。ダイアログの背景は弱い暗幕とし、元のボードとの位置関係が分かる。

## Shapes

付箋は `{rounded.sm}`、通常のボタンと入力は `{rounded.md}`、ドロワーの左隅は `{rounded.lg}`。ピル形状は小さなカウントとアバターに限定。装飾目的の有機形状やグラデーションを加えない。

## Components

YAML padding は単一Dimension。横方向はボタン・入力12px、カード7pxを実装上の補正として用い、縦方向は各トークンの8px・5pxを基準にする。

PBI 選択は検索・最大6件・適用・キャンセルの明示的なフロー。選択はブラウザー内、順序は取得元の順序。Priority を取得していないときに Priority 順と断言しない。

カードと PBI はどちらも Issue エディターを開く。閲覧、編集、保存中、競合、部分保存、結果不明、再取得失敗を区別する。未保存の変更を静かに捨てない。通信中に別 Issue へ飛ばない。競合・結果不明は自動再送せず、最新状態を読み直して利用者が次の変更を決める。エラーは消えるトーストだけに依存せずエディターに残す。

フォーカスリングは3px。Escape はダイアログを閉じるが、未保存の確認を経由する。Tab はネイティブ dialog 内に留まり、閉じると起点へ戻る。ドラッグ以外に Status セレクトから同じ操作ができる。アニメーションは180ms程度、reduced-motion で停止する。

## Do's and Don'ts

- 原文・アバター・状態の意味を維持する。色だけで情報を伝えない。
- 最初の4枚を必ず見せ、残りを件数で明示する。
- 保存結果を GitHub から確認し、失敗・競合・更新時刻を正直に表示する。
- 完了と Issue の close を同義としない。見送りを完了に数えない。
- 白い作業面を基本に、長文の可読性とキーボード操作を実機サイズで検証する。
- 宣伝ページ、サイドナビ常設、意味のないカード列、ダミーの実績値を追加しない。
