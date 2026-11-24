# 015: 会議まとめ — 議事録・文字起こしを必要な時だけ AI で整理して見せる

2026-11-22。オーナーの方針メモ（2026-11-21）「議事録、文字起こしが有効活用できていないので、claude meeting 的な感じで、議事録を AI を使って特にわかりやすく取りたい時に起動し、視覚的に整理してくれる機能を作りたい」への対応。

## 背景

- 議事録と文字起こしは `engineer-first/meeting-logger`（private）が毎日 GitHub へ保存している。議事録 `docs/meeting-logs/minutes/YYYY/MM/YYYY-MM-DD.md`（LLM 生成、1日約6KB）、文字起こし `docs/meeting-logs/transcripts/YYYY/MM/YYYY-MM-DD-{am,pm}.md`（半日約8万字、誤認識が多い）。
- 形式は整っているが長文で、会議中・会議後にボードの前で振り返る導線が無い。文字起こしはほぼ読まれていない。
- 2026-11-19 の bestofn では「文字起こしの完成タイミングが読めないので議事録連携は将来」と判断した。今回はリアルタイム連携ではなく「保存済みの記録を、見たい時に整理する」に絞ることで、その懸念を避ける。

## 判断

- ツールバー「会議まとめ」（M）から右 88% のドロワーを開き、記録を選んで「AIで整理」を押した時だけ生成する。自動生成・定期生成はしない（費用と、読まれない出力を増やさないため）。
- 出力は 決まったこと／次にやること／未決・持ち越し の3列、会議の流れ（文字起こしを読んだ時だけ）、話題カード。項目と話題は相互に強調され、PBI チップからボードと同じエディターを開ける。根拠は文字起こしのチャンク anchor へリンクする。
- 入力は2経路。(a) meeting-logger の日付を選ぶ（議事録、任意で文字起こし）。(b) 貼り付け。(b) は App 権限の拡張なしで使える。
- サーバー `server/meetings.mjs` は読み取り専用。GitHub へ書かないので Issue mutation の DO queue は通さない。
- AI 出力は構造化出力（JSON Schema）で受け、サーバーで再検証する。候補に無い PBI 番号、存在しないチャンク、範囲外の話題添字は捨てる。担当・期限は記録に明示された時だけ（プロンプトで指示、UI は空なら「担当未定」と明示）。
- 結果は保存しない。タブ内のメモリーで同じ日付・同じ入力範囲の再表示に使い、再生成は明示操作だけ。失敗時も自動再送しない（読み取りなので安全だが、費用がかかる）。
- 入力が40万字を超えたら黙って切り詰めず 413 で断る。
- AI は OpenAI Responses API（公式 `openai` SDK を Worker から呼ぶ）。チームが Codex 用に持つ API キーの残り枠を使う。既定モデルは `gpt-6.1-terra`（`MEETINGS_MODEL` で上書き可）、reasoning effort medium、`store: false` で会議記録を OpenAI 側の会話履歴に残さない。
- 当初は Anthropic API（Claude Opus 5.5）で実装したが、2026-11-25 にオーナーが「新たな従量課金契約は承認しない、既にある OpenAI キーを使う」と判断したため置き換えた。Worker では meeting-logger のような Codex CLI のサブスク認証を使えないため、API キーは必要。

## 境界・安全

- **公開モード（public-temporary）では `/api/meetings*` は常に 404**。会議発言は私的データで、匿名閲覧者に存在も見せない。ボタンも隠す（表示用。認可はサーバー側）。
- チームモードは既存の Worker 認証を通った principal のみ。POST は Origin 一致を要求。
- 本文・AI 出力をログやエラー応答へ含めない。エラーはコードだけ返す。
- meeting-logger 用のトークンはボード用とは別に、`repositories: ["meeting-logger"]`・`permissions: { contents: "read" }` だけで発行する。ボードの書き込み権限と混ぜない。
- 同じ利用者の同時実行は 409。isolate 単位なので厳密な上限ではない。

## 有効化に必要な承認（未実施）

コードは未設定時に fail closed で、以下が揃うまで本番では動かない。いずれも AGENTS.md の「外部認証設定・秘密・権限拡張・有料契約は明示承認」に当たるため、実装者は行っていない。

1. AI: 既存の OpenAI API キーを `OPENAI_API_KEY` として Worker secret に登録し（キーの利用はオーナー承認済み、登録作業は未実施）、`MEETINGS_AI_ENABLED=true`。会議記録は OpenAI へ送られる（meeting-logger も同じく OpenAI のモデルへ送っている）。
2. 議事録の選択: GitHub App「Idea Boost Whiteboard」に Repository permission `Contents: Read-only` を追加し（org owner の再承認が要る）、installation の対象 repo に `meeting-logger` を追加。その後 `MEETINGS_LOGGER_READ_ENABLED=true`。2 が無くても 1 だけで「貼り付け」は使える。

目安費用（gpt-6.1-terra、$1/$5 per MTok）: 議事録のみ 1回 1円未満、文字起こし込み（約10万トークン入力）で 1回 約20円。

## 採用しなかった案

- 会議中のリアルタイム構造化（bestofn 20261122 案）: 録音側（Fedora・meeting-logger）のライブ配信口が必要で、本リポジトリの範囲を超える。今回の整理結果の型（決定・やること・未決・話題）はその前段として再利用できる。
- 生成結果を Durable Object や GitHub に保存: 共有・履歴の要否が未確定。保存先によっては新しい公開範囲の判断が要るため、まず「見たい時に作る」で使われ方を確かめる。
- やることを AI が Issue / 付箋として自動作成: 「AIが作ったものは人の思うものと違うことが多い」（2026-11-19 フィードバック）。今回は表示と Markdown コピーまで。付箋機能（別検討中）と接続する時に人が選んで送る形にする。
- Workers AI 等の別基盤: 日本語の長文要約品質と構造化出力の確実さを優先。

## 検証

`server/meetings.test.mjs`（公開モード 404・未設定 503・principal/Origin・専用最小権限トークン・権限拒否を空一覧と取り違えない・PBI/根拠の検証・貼り付け経路・超過 413・不正入力・AI 不完全時に本文を返さない・同時実行 409）、`tests/browser/meeting.spec.ts`（3列/話題/流れの表示、相互強調、再表示で再生成しない、PBI からエディター、失敗は明示再試行のみ、未設定・公開モード）。実 API・実 meeting-logger への接続試験は承認前のため未実施。
