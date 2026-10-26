# 本番配信記録 — 2026-10-26

- Source code commit: `5cf69633dda4f9934a9f50e44149c4ead57436f9`
- CI: https://github.com/junhat6/ideaboost-whiteboard/actions/runs/40268427116 （success）
- Worker: `ideaboost-whiteboard`
- Cloudflare account: `junhat6@gmail.com` / `29a0469ba7d11f29ac94e3ed41f388a8`
- Plan: Free。アップグレード・有料契約変更なし。
- Host: `https://ideaboost-whiteboard.ideaboost-whiteboard.workers.dev`
- Active version: `1716b698-4996-4177-aed0-4a7617a00e67` （PBI完全行の端数ピクセル修正を反映）
- Access: `public-temporary`。ランダム24byte由来の48hexパス配下で匿名閲覧・編集。パスそのものはこの記録に固定せず、配信設定と所有者への報告に保持。
- App ID `5473658`、installation `175301060`。追加本番鍵をserver secretに保存。既存デモ鍵を保持。一時PEM削除済み。App権限・インストール対象の追加なし。
- Source repositoryはprivate。既存Sitesデモと実Issueはテスト目的で変更していない。

## 本番で実施した確認

- TLS成立、正pathのHTML/assets/health=200、health configured=true。
- 実GitHub board=200、14 PBI・24 tasks。repo/Projectのpublic検査を通過。
- 1920×1080と2560×1440のChromiumで6 PBI・15カード。ページ縦スクロールなし、タイトル部分行切れなし、タスク/PBIともタイトル内スクロール0件、アバター8要素。
- 各サイズで2回のIssue編集→キャンセル、PBI drawer、Fullscreen API、ボードクリックによるツールバー閉鎖。JS page errorなし。
- ブラウザーQAは全POSTを遮断し、実際のPOST要求0件。
- 別途パス外404、別Origin POST403、未知フィールドを持つ不正payload400。最後のpayloadは共通validateMutationでintent/GitHub呼出し前に拒否されることをコード・回帰試験で確認した非破壊試験。
- 可視中の自動更新による追加board取得200を確認。
- 実Durable Objectで、正本と異なる既知の古いrevision（1970年）を指定した要求は409 conflict。同じrequest IDは409 request_already_processed。送信したタイトルは現状と同一で、GitHub mutation前のrevision検査で拒否される非破壊検証。
- 本番secret名登録の成功と、配信versionをWranglerで確認。秘密値の出力なし。

## ローカル・CIの確認

lint/typecheck、GitHub mock19件、JWT/route5件、共有coordinator8件、公開境界3件、Chromium36件、Wrangler build。Google DESIGN.md lintエラー0・未参照token警告17。別Worker同時保存、未知結果の永続停止、無効要求10,001件でledger消費0を含む。

## 未実施・制約

実Issueの成功する変更はQAでは実行していない。保存の成功/競合/部分反映はmock試験であり、本番書込成功とは報告しない。GitHub直接編集との競合窓、Issue/Project更新の非原子性、結果不明時の管理者保守、近似的なlocation単位rate limitはADR/OPERATIONS記載通り。

この文書は配信後の記録であり、文書を追加したcommitと上記の実配信source commitは区別する。
