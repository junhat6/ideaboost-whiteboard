# 010: 見慣れた表示とチーム特化操作

GitHub Projectsの既知表現を優先し、詳細Statusを基準とした列ラベル、flatな青い分割進捗を採用する。担当者avatarタイルは維持。正常な保存済み/同期中を常設せず、明示保存と問題時の回復操作を残す。POST中の追加入力は送信時baselineとは分離して保持する。

関連PRは公式 [Issue.closedByPullRequestsReferences](https://docs.github.com/en/graphql/reference/issues#issue) を `includeClosedPrs:true, excludeUserLinked:false` で取得する。本文URLやcross-reference mentionは推測しない。既存の軽量Issue scope検証と前後公開確認を用い、全board再取得や初回board待ちを増やさない。50件ずつcursor pagination。初版は固定repo engineer-first/idea-boostの公開PRのみ、cross-repo/privateは表示しない。null/途中失敗は空扱いしない。App権限を黙って拡張せず、拒否時は取得不可として報告する。

[Octicons 19.42.0](https://github.com/primer/octicons/releases/tag/%40primer%2Focticons%4019.42.0) はGitHub公式MIT。ビルド時に11 SVGだけをローカルassetsへ生成（7,312bytes未圧縮）。[Lucide vanilla](https://lucide.dev/guide/lucide/) も適合するが、今回はPR状態を含めたGitHub慣例への一致を優先。Icon/Kbdの寸法とbusy/focusを共通CSSで管理し、ライブラリだけで全ての表示バグがなくなるとは考えない。
