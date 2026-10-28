# 連続ドラッグ回帰（2026-10-28）

## 再現と修正

- 修正前の [CI 40629505336](https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40629505336) で、最初の POST 待ち／ACK 後 GET 待ちに別 Issue の `draggable=false`、POST 1 件、2 枚目の native dragstart 不発を再現。
- 保存を既存の Issue 別 job に統一。別 Issue を止めず、同じ Issue の保存中・結果不明は止める。canonical revision、応答所有権、見積失効、古い GET の遮断、gesture 中の DOM 維持を回帰で検証する。
- 試験はローカル synthetic API のみ。本番 Issue 書込みはしない。

## Escape 自動化の境界

[計測 CI 40632145709](https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40632145709) は先行ドラッグ 42 件成功後、全体実行で端スクロール取消を再現した。

synthetic desktop の抜粋（時刻はページ内 performance.now、ms）：

- アプリ `tickDragScroll` の最後の scrollTop setter：618.1、値 32。
- `dragend`：626.7、値 32、対象 node は接続中。
- その後、**JavaScript setter は一度も呼ばれず**、699.4 / 716.7 / 733.7 に値 50 / 68 / 86 へ変化。
- Escape の後に `page.mouse.up()` は実行済み。停止後の RAF 7 samples は `[32,32,32,32,50,68,86]`。

これはアプリの RAF 残留ではなく、自動化経路の native 側スクロール。実 OS の Escape と同じ結果とは断定しない。

一次ソース：

- [Playwright crDragDrop.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/crDragDrop.ts)：`cancelDrag()` は CDP `Input.dispatchDragEvent(type: dragCancel)` を送る。
- [Playwright crInput.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/crInput.ts)：ドラッグ中の Escape はこの取消で短絡し、通常 keydown を送らない。インストール済み 1.64.1 の bundle でも確認。
- [Chromium input_handler.cc](https://github.com/chromium/chromium/blob/main/content/browser/devtools/protocol/input_handler.cc)：CDP DragCancel は source 終了を呼び、target の DragLeave を通らない。
- [Chromium drag_controller.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/page/drag_controller.cc)：target の DragExited は CancelDragAndDrop を呼ぶ。

このため製品に scroll 巻戻しや overflow 切替を入れない。回帰を次の二つへ分ける。

1. 端から実 pointer を外へ離し release：0 POST、dragend 後アプリ write 0、7 RAF の scrollTop 完全一致、次 drag 成功。
2. Escape：0 POST、dragend 後アプリ write 0、次 drag 成功。**実 OS Escape 後の native scroll 停止との同等性は未検証**。

計測ログと元の失敗を隠さず保持し、sleep・再送・scrollTop 操作で試験を通さない。
