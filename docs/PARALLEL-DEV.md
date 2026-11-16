# 並列開発 (Orca worktree)

Orca で 1 タスク = 1 worktree として並列に作業するための準備と後片付け。設定はリポジトリ直下の [`orca.yaml`](../orca.yaml)、実装は `scripts/worktree/`。

## worktree 作成時 (setup)

`orca.yaml` の `scripts.setup` が `scripts/worktree/hook.sh setup` → `setup.mjs` を実行する。`setupAgentStartupPolicy: wait-for-setup` により agent は setup 完了後に起動する。依存や bundle が揃う前に agent が `npm run check` / e2e を走らせ、環境起因の失敗を実装の失敗と取り違えるのを防ぐため。

| 手順 | 内容 | 理由 |
| --- | --- | --- |
| Node 確認 | `>=22` 未満なら停止。24 以外は注意表示 | `engines` と CI (24) に合わせる |
| 設定ファイル共有 | main checkout の `.dev.vars*` / `.env*` (`.env.example` 以外) を symlink | 秘密を worktree 数だけ複製しない。値は読まず表示しない |
| 依存 | `package-lock.json` の SHA-256 が前回と違うときだけ `npm ci` | node_modules は branch ごとに異なりうるため共有しない。再実行を速くする |
| 生成物 | `npm run build:editor` | `web/*-bundle.js` 等は git 管理外で、preview / e2e / build の前提 |
| Chromium | `playwright install chromium` (共有キャッシュにあれば即終了、失敗は警告のみ) | e2e をすぐ回せるようにする |
| port 割当 | 空き slot を `.worktree/ports.json` に書く | 下記 |

## port の分離

e2e の preview サーバーと `wrangler dev` は固定 port だったため、2 つの worktree で同時に `npm run test:e2e` を走らせると後発が起動に失敗するか、他 worktree のサーバーへ接続して誤った結果を返していた。

| | main checkout / CI | 追加 worktree (slot n = 1..99) |
| --- | --- | --- |
| preview (e2e) | 4183 | 4300 + n |
| wrangler dev | 8787 | 8800 + n |
| inspector | 9229 | 9300 + n |

- 優先順位は 環境変数 (`PREVIEW_PORT` / `WRANGLER_DEV_PORT` / `WRANGLER_INSPECTOR_PORT`) > `.worktree/ports.json` > 既定値。`.worktree/` が無い CI と main checkout の挙動は変わらない。
- 割当台帳は git の共通ディレクトリ (`.git/orca-worktree-ports.json`) にあり、全 worktree が同じ台帳を見る。Orca が同時に複数 worktree を作っても重複しないよう mkdir ロックで直列化し、実際に bind できる slot だけを選ぶ。
- 消えた worktree の割当は次の割当時に回収する。
- 現在の port は `npm run worktree:ports`。

`playwright.config.ts`・`scripts/preview.mjs`・`npm run dev` (`scripts/worktree/dev.mjs`) がこの値を読む。

## worktree 削除時 (archive)

`scripts.archive` が `archive.mjs` を実行する。削除を止めないよう、各手順の失敗は警告にとどめて常に成功で終える。

1. この worktree の port で待ち受けるプロセスのうち、**cwd がこの worktree 配下のもの**だけを SIGTERM (3 秒後に残れば SIGKILL)。他の checkout のサーバーは止めない。
2. port slot を台帳から解放する。
3. 未コミットの変更と、どの remote にも無い commit をログに残す。branch は消さない。

## 手動実行

Orca を使わない `git worktree add` でも同じ準備ができる。

```sh
npm run worktree:setup     # 何度実行してもよい
npm run worktree:archive   # git worktree remove の前に
```

main checkout では port 割当と archive を行わない。

## 並列作業の注意

- 実 GitHub への書き込み・本番 deploy は並列 worktree から行わない (AGENTS.md の境界は worktree でも同じ)。
- `.wrangler/` の local Durable Object 状態は worktree ごとに独立する。
- CI は `.worktree/` を持たないため従来の port で 1 回ずつ実行する。
