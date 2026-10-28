# 付箋可読性・未見積motionの回帰記録

実Issueを書き換えず、GitHub Actionsのsynthetic fixtureだけで検証する。

## タイトルの面積

- 1920×1080、6 PBI、overflowセル先頭4枚、43字の日本語タイトルで検証。
- 初版の実Range計測（run 40643362730）: card高59.531px / title可用高39.531px / 11px・行高13.75px。完全な2行・25字しか表示できず、3行assertを失敗させた。
- 原因は `#board.compact .cell` の詳細度が task-cell の意図した縦paddingに勝つこと。CJK字形の上下余白ではなかった。
- compactのtask-cellだけ上下paddingを約10px→最大6pxへ補正。PBI/goal、横余白、grid間隔、font、16pxのavatar/h欄は重ねない。
- 補正後run 40644652702の同一43字fixtureは11pxのまま3完全行・38字（可用高43.766px）へ増えた。他3枚は34〜38字の全文が3行で表示された。両画面幅・light/darkの3完全行/30字以上・文字とavatar/hの非交差・contrast 7:1以上を確認。1920のPNGも目視した。
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

## 最終判断：全対象の連続cueを維持

- transform版の一周/全角/resize/停止/中心pixel不変はrun 40646905915で成功。全514 browserも成功したが、性能確認前の配信はlatest-main guardで停止した。
- run 40647895653の同page A/Bでは、mask→外周clipや影の除去による一貫した改善はこの比較で確認できなかった。見た目を劣化させて速度改善を主張せず、元の静的mask＋transformを採用する。
- run 40649664536で少数/中規模の比較条件6/24枚とstress94枚を同じ6PBI DOMで計測した（OFF/ON各60rAF×2窓、light、HeadlessChrome 156.0.8078.4）。

| 幅 / 未見積数 | OFF平均 / p95 ms | ON平均 / p95 ms |
|---|---:|---:|
| 1920 / 6 | 16.67 / 16.7 | 16.66 / 16.7 |
| 2560 / 6 | 16.67 / 16.8 | 16.67 / 16.8 |
| 1920 / 24 | 16.67 / 16.7 | 16.67 / 16.7 |
| 2560 / 24 | 16.67 / 16.7 | 17.92 / 33.3 |
| 1920 / 94 | 16.67 / 16.8 | 34.58 / 66.7 |
| 2560 / 94 | 16.67 / 16.8 | 45.00 / 66.7 |

- 6枚では同等、24枚のwideでは少し負荷が増え、94枚同時は明確な限界が残る。全端末60fps・一律高速化・GPU原因の確定は主張しない。6/24枚が実際の利用件数だと確認したものではない。利用者端末の物理サイズ/OS倍率/実GPUは別の未検証条件。
- 94枚だけ別区間2秒のtraceで94 animationの開始/状態/終了470eventを捕捉し、compositeFailed/unsupportedPropertiesの記録は無かった。ただし記録が無いことだけでGPU合成を保証しない。Raster durationは欠測unknown、Paintのdur合算は経過時間ではない。
- ユーザーが嫌った強調の途切れを戻さないため、動く対象を恣意的に間引かず全対象の静的cueと連続motionを維持する。画面外・drag・reduced-motionだけ既定の停止条件とする。
- 再現fixture/一時配信停止の履歴はcommit `abae3ea768910e65ed3142c762bad185e872e57b`。最終版からtemporary profile、長い回帰のskip、deploy=falseを除去し、同じ最終SHAで全514 browserとhealth/assets確認を必須に戻す。
