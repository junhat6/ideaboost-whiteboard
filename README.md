# IdeaBoost Whiteboard

IdeaBoost チーム専用の GitHub Issue / Projects ホワイトボード。ライトモードを中心に、6 PBI × 4状態列の俯瞰と Issue の編集を提供します。

**現在の段階:** Cloudflare Freeへ配信済み。本番からGitHub正本を読み取り、両デスクトップサイズで表示を確認しました。明示承認された一時的な匿名閲覧・編集モードです。URLを知る全員が編集でき、長いパスは認証ではありません。配信記録は [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 開発

Node 24 を推奨。

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm run dev` は設定されたアクセスモードを含むWorkerを起動します。public-temporaryを明示したときだけ匿名編集となります。UIのテストは `scripts/preview.mjs` に対して Playwright が合成データのAPIを差し込みます。テストサーバーはlocalhost限定、実GitHubへの通信・書き込み・秘密なし。

## 構成

- [DESIGN.md](DESIGN.md): Google alpha形式のデザイン仕様。3サービスの資料調査を経て作成。
- [AGENTS.md](AGENTS.md): 開発・安全・検証規約。
- `web/`: 日本語ボード、ドラッグ、PBI選択、エディター、45秒更新。
- `worker/coordinator.ts`: Issue単位の共有直列化と永続request記録。
- `worker/`: Access JWTとメールallowlistの検証、全ルート保護、セキュリティヘッダー。
- `server/github.mjs`: GitHub App認証、ページング、正式な親子関係、競合検査、変更とreadback。
- [docs/adr](docs/adr): アーキテクチャと競合の決定記録。
- [docs/OPERATIONS.md](docs/OPERATIONS.md): 承認が必要な設定、本番導入、障害対応。
- [docs/TESTING.md](docs/TESTING.md): 試験範囲と限界。

対象は `engineer-first/idea-boost`、組織 Project 3 / view 16 に固定。PBI行だけビューで絞り、正式な子・孫IssueをProjectから展開します。Issue番号はAPIで固定リポジトリに解決し、他のProjectへの自由なプロキシにはしません。

GitHubが正本。localStorageに保存するのはPBI選択とテーマだけです。ユーザーの本文はMarkdown原文をテキストで表示するため、HTMLは実行しません。

## セキュリティ・同時更新

既定のチームモードはAccessの署名、issuer、audience、iat/exp、subject、メールallowlistを毎リクエスト検証します。一時公開モードでは匿名編集を認め、固定パス・host・rate limitと公開repo/Project検証を適用します。平文の認証済みメールヘッダーは信用しません。POSTは同一originとJSON、入力フィールド・サイズ制限を検証。App tokenと秘密鍵はサーバーだけです。

保存はIssue単位のDurable Objectを通して直列化し、変更フィールドだけを送信。updatedAt、内容のSHA-256、raw Statusを最新GitHubデータと比較します。IssueとProjectの変更は原子的ではなく、外部更新との最後の競合窓が残ります。部分反映・結果不明はエディターに残し、追加保存を停止します。永続pendingが残った場合は管理者の調査が必要です。自動再送はしません。詳細はADR 002。

## 由来

既存の非公開 Sites デモのソース `134ee3e2536fff7b4567c4aa8baa9df08d9d9f63` からUIとGitHub境界を継承。デモ自体は変更していません。このリポジトリは運用先 `engineer-first/idea-boost` と別で、GitHub Appのインストール対象拡大は不要です。
