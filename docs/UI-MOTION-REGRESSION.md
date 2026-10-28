# 付箋可読性・未見積motionの回帰記録

実Issueを書き換えず、GitHub Actionsのsynthetic fixtureだけで検証する。

## タイトルの面積

- 1920×1080、6 PBI、overflowセル先頭4枚、43字の日本語タイトルで検証。
- 初版の実Range計測（run 40643362730）: card高59.531px / title可用高39.531px / 11px・行高13.75px。完全な2行・25字しか表示できず、3行assertを失敗させた。
- 原因は `#board.compact .cell` の詳細度が task-cell の意図した縦paddingに勝つこと。CJK字形の上下余白ではなかった。
- compactのtask-cellだけ上下paddingを約10px→最大6pxへ補正。PBI/goal、横余白、grid間隔、font、16pxのavatar/h欄は重ねない。
- 補正後run 40644652702の先行で、両画面幅・light/darkの3完全行/30字以上・文字とavatar/hの非交差・contrast 7:1以上を確認。1920のPNGも目視した。
- 全文が常に収まる保証ではない。長文は付箋内scrollと詳細で保持し、tooltipへの依存はなくす。OSごとの日本語font実描画は未検証。

## 境界を流れる光

- 同じcardでU前後のgeometry/紙面pixel不変、実時間のframe間で境界だけ変化・中心pixel差0を検証。
- 静的1px cueは動作中も停止中も残す。未取得≠null、0h≠未見積、公開失効clear、overflow外/drag中pause、reduced-motion静止は既存契約。
- 初版のoffset-distanceは94枚同時の負荷が高かった。run 40644652702、同page/同DOMでOFF/ON各60rAF×2窓の結果:

| viewport/theme | OFF p50 / p95 ms | ON p50 / p95 ms |
|---|---:|---:|
| 1920 light | 16.7 / 16.8 | 33.3 / 50.0 |
| 1920 dark | 16.7 / 16.8 | 33.3 / 50.0 |
| 2560 light | 16.7 / 16.8 | 50.0 / 66.8 |
| 2560 dark | 16.7 / 16.7 | 50.0 / 83.3 |

- この差を無視して性能合格にせず、形状/mask/周期を維持しtransform移動へ置換する。Chromiumの[compositable property実装](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/animation/compositor_animations.cc)と[animation指針](https://web.dev/articles/animations-guide)を根拠に候補を選んだ。
- transform使用だけで実compositor実行や性能向上を断定しない。同じOFF/ON比較、実一周とresize後のframeで再判定する。rAF間隔はheadless CIの指標であり、利用者端末の描画FPSやGPU時間ではない。
- `will-change`の全付箋強制、毎frame JS、外部font、新libraryは追加しない。

## chart

run 40642387761でdesktopの新layout5件＋既存41件成功。70vw、右上calendar、小さい明示save、Escape二段/Tab focus、draft保持、360ms登場の実frameを確認。途中・到着PNGを目視。最終releaseでは両幅の全browserとhealth/assets照合を再実行する。
