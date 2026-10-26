# ADR009: 青基調の読書面と自然な図スクロール

利用者の最新指示を優先し、進捗のDone green連動を廃止してblue accentへ分離する。canonical Status colorは小さなmarkerに保持し、type付箋色も保持。Status詳細はGitHub比較画像の輪郭＋淡い内側、選択はcheckで示す。全体をGitHubの完全コピーとはしない。

DESIGN.mdにcanvas/surface/ink/muted/primary/selected/input-border/progress/statusを定義し、CSS変数と対応を単体試験する。旧--greenは--accentへ改称。本文#182B49/白14.18、補助#475569/白7.58、accent#3159C9/白6.17、progress完了/未完了3.92、入力境界/白3.36。薄いlineは構造区切りのみ。Demo goalは白面、上下6px、上寄せ、元のフォントサイズを保持し、利用可能高を整数行で使う。

図がwheelを奪った原因はPeleジェスチャーでなくcanvasのoverflow:autoとoverscroll-behavior:contain。overflow:hiddenとautoに変更し、通常wheelはnativeに親へ渡す。overflow:clipは明示drag用scrollLeft/Topまで無効にするため使わない。preventDefault/イベント転送は追加せず、Cmd/Ctrl zoomも横取りしない。図は±/Fitと拡大後dragで操作する。

性能面の限定改善は同一作者DOMの保持。authorが変わるか公開境界で内容が消えた場合は再描画する。API/鮮度/媒体queue/renderer安全上限を省略しない。
