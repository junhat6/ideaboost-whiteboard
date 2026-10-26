# IdeaBoost Whiteboard

IdeaBoost チーム専用の GitHub Issue / Projects ホワイトボード。ライトモードを中心に、6 PBI × 4状態列の俯瞰と Issue の編集を提供します。

**現在の段階:** ローカル実装・自動試験済み。本番 Cloudflare の認証、Access allowlist、GitHub App 秘密鍵の移行は未設定。未設定のWorkerは503で拒否します。利用可能な本番サービスと誤認しないでください。

## 開発

Node 24 を推奨。

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm run dev` は認証境界を含むWorkerを起動します。認証バイパスはありません。UIのテストは `scripts/preview.mjs` に対して Playwright が合成データのAPIを差し込みます。テストサーバーはlocalhost限定、実GitHubへの通信・書き込み・秘密なし。

## 構成

- [DESIGN.md](DESIGN.md): Google alpha形式のデザイン仕様。3サービスの資料調査を経て作成。
- [AGENTS.md](AGENTS.md): 開発・安全・検証規約。
- `web/`: 日本語ボード、ドラッグ、PBI選択、エディター、45秒更新。
- `worker/`: Access JWTとメールallowlistの検証、全ルート保護、セキュリティヘッダー。
- `server/github.mjs`: GitHub App認証、ページング、正式な親子関係、競合検査、変更とreadback。
- [docs/adr](docs/adr): アーキテクチャと競合の決定記録。
- [docs/OPERATIONS.md](docs/OPERATIONS.md): 承認が必要な設定、本番導入、障害対応。
- [docs/TESTING.md](docs/TESTING.md): 試験範囲と限界。

対象は `engineer-first/idea-boost`、組織 Project 3 / view 16 に固定。PBI行だけビューで絞り、正式な子・孫IssueをProjectから展開します。Issue番号はAPIで固定リポジトリに解決し、他のProjectへの自由なプロキシにはしません。

GitHubが正本。localStorageに保存するのはPBI選択とテーマだけです。ユーザーの本文はMarkdown原文をテキストで表示するため、HTMLは実行しません。

## セキュリティ・同時更新

Accessの署名、issuer、audience、iat/exp、subject、メールallowlistを毎リクエスト検証します。平文の認証済みメールヘッダーは信用しません。POSTは同一originとJSON、入力フィールド・サイズ制限を検証。App tokenと秘密鍵はサーバーだけです。

保存は変更フィールドだけを送信。updatedAt、内容のSHA-256、raw Statusを最新GitHubデータと比較します。IssueとProjectの変更は原子的ではなく、外部更新との最後の競合窓が残ります。部分反映・結果不明はエディターに残し、再読込まで追加保存を停止します。自動再送はしません。詳細はADR 002。

## 由来

既存の非公開 Sites デモのソース `134ee3e2536fff7b4567c4aa8baa9df08d9d9f63` からUIとGitHub境界を継承。デモ自体は変更していません。このリポジトリは運用先 `engineer-first/idea-boost` と別で、GitHub Appのインストール対象拡大は不要です。
