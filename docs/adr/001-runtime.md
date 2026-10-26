# ADR 001: 静的UIと単一 Cloudflare Worker

採用: 元デモの検証済み DOM UI と GitHub adapter を分離して継承し、Cloudflare Worker の認証境界を新設する。フレームワーク、データベース鏡像、独自パスワード認証を導入しない。

Cloudflare Access のメール OTP と明示的 allowlist を候補とする。Access の署名済みJWTをWorkerでも検証し、同じallowlistで全API・全静的アセットを保護。run_worker_first:true。未設定なら503、認証なし401、非メンバー403。プレビューURLは無効。設定の承認は別途必要。

GitHub App tokenはサーバーメモリ内のみ。GitHub Appの既存権限を拡張しない。チームメンバーへの代理操作はApp名で記録されるため、個人のGitHub OAuth代理操作とは異なる。

UI状態はPBI選択とテーマだけlocalStorage。Issueの本文・担当者・tokenは永続化しない。45秒の可視中更新とfocus更新を行い、編集/drag/picker/通信中は停止する。

変更可能性: GitHub transport、Access auth、UIを分離。認証IdPを変更してもGitHub/domain契約に影響しない。
