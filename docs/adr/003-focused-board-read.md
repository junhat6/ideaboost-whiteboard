# 003: PBIビューは正式な子孫を対象に読み取る

2026-10-26。初回の全Project階層走査が支配的だったため、読み取り戦略を分離する。

## 判断

固定view 16が明示的な`type:PBI`条件を持ち、`@me`など実行者依存条件を含まない場合、PBI行をviewから取得し、Projectの`parent-issue`フィルターで正式な直接の子を取得する。子に子がある場合は次の階層を明示的に問い合わせる。フィルターが再帰的だとは仮定しない。各結果の実際の`parent.id`、repository、Issue type、非archive状態を検証する。PBIに到達したら祖先PBIのタスクとしての探索を止める。子PBI自身が選択行なら別の起点になる。

同時に、全Projectを軽いID・repository・milestone索引として取得し、元の順序、Project所属、全体のマイルストーン選択肢を維持する。探索順や応答完了順を表示順に使わない。子孫は各階層・各親グループで全ページを読む。上限超過、欠損、進まないcursorを黙って部分成功にしない。

初期応答には表示対象の完全なtitle/body/assignees/revision/Status/fingerprintを含める。本文を空文字で代用したsummaryは導入しない。Demo goal、本文検索、即時Issue表示、dragのpreconditionを維持する。担当者一覧は並列取得する。

PBI以外のview・実行者依存viewでは既存の全件走査へ戻る。**保存は常に全write scope取得と最終preflight/readbackを使用**し、この表示対象最適化に認可・競合検出を委ねない。

## 公開境界と鮮度

bootstrapでrepository/Projectの公開状態・meta・先頭の索引を1つのGraphQL応答から取得し、公開を確認してから後続処理を進める。応答を返す前にも公開状態を再検査する。公開が不明・非公開ならデータを返さない。

ボードキャッシュは導入しない。GitHubの複数API読み取りは原子的なスナップショットではなく、直接編集やGitHub側フィルターの反映時間による差は残る。これは取得済み本文を新しい本文と偽る仕組みではない。GitHub直接編集との競合制約は002を継続する。

## 検証

全走査との同値性（子・孫・全文・Status・milestone）、階層ごとのページング、異なるrepository/非親/archived項目の除外、Project順保持をmockで検証。公開→非公開の遷移拒否は両戦略に適用。実データの件数・両解像度・待ち時間を本番で別途確認する。

根拠: [GitHubのparent-issueフィルター](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/filtering-projects#filtering-by-parent-issue)、[IssueのsubIssuesSummary](https://docs.github.com/en/graphql/reference/issues)。
