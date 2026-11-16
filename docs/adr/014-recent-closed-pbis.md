# 014: 最近Closeした PBI を明示opt-inで候補に戻す

2026-11-16。物理ホワイトボードを廃止し本アプリで代替したところ、PBI を Close するとボードから消え、スプリントレビュー資料に貼る「達成したことが分かるボードのスクリーンショット」が撮れなくなった。

## 原因

PBI行は view 16 のフィルター（`repo:engineer-first/idea-boost is:issue type:PBI is:open`）で取得している（ADR 003）。Close済みPBIは `is:open` に一致しないため候補に含まれない。

## 判断

- 管理するPBIのpickerに「最近Closeした PBI も候補に含める（過去28日）」を置く。既定はOFF。
- ONの時だけ `GET /api/board?closed=recent` とし、サーバーはview条件の `is:open` を `is:closed closed:>=<28日前>` に置き換えた2本目のPBI行queryを並列で読む。子孫の展開、Project順（POSITION）、milestone絞り込み、公開確認は既存の経路をそのまま通す。
- 28日はスプリント2回分。全期間のClose済み（現時点74件）を毎回子孫まで展開すると読取が重くなるため、レビューに必要な直近に限る。
- view条件に `is:open` が無い場合は書き換えない（既にClose済みを含む、または別の意図の条件）。応答の `scope.recentClosed` が null になり、pickerは追加取得できないことを示す。
- 共有snapshot（ADR 004）は既定の読取だけに使い、`closed=recent` は毎回fresh。既定の読取量・応答は変えない。
- 設定はブラウザーごと（localStorage）。PBI選択と同じく、GitHub側の共有設定は変えない。

## 採用しなかった案

- 常にClose済みを含める: 日常のタスク管理で終わったPBIが混ざり、読取も増える。
- 選択中のmilestoneでだけ含める: 既定のビュー範囲（milestone未選択）で使えず、レビュー時に毎回Sprintを選び直す必要がある。
- view 16 の条件自体を変える: GitHub側の共有ビューを変えると他の利用者のProject表示まで変わる。

## 検証

`server/recent-closed.test.mjs`（既定はClose行を問い合わせない、opt-inでProject順・子孫込みで追加、query検証）、`tests/reader.test.ts`（snapshotを使わない）、`tests/browser/recent-closed-pbis.spec.ts`（picker切替・ボードのラベル・再読込での保持・OFF時の範囲外保持）。
