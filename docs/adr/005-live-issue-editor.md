# 005: 即時入力と同期を両立するIssue編集

2026-10-26。利用者の指示により編集モード切替・常設再取得・重複メタデータを廃止。右80%の詳細は開いてすぐ入力できる。明示保存は維持し、自動保存は導入しない。

## 原文と入力

CodeMirror 6をローカルbundleとして詳細を開いた時だけ読み込む。GFMの構文装飾、履歴、選択、IMEはエンジンへ委ね、独自contentEditableを実装しない。正本はMarkdown文字列。HTMLへの変換結果を保存しない。単一ペインのプレビューはmarked+DOMPurifyのallowlistとURL検証を通し、画像・スクリプト・任意HTMLを実行しない。bundle失敗時はtextareaで入力を継続する。外部CDNは不要。

タイトルリンクとタイトル入力は別要素。タイトル変更時のクリックで外部へ移動しない。本文・担当者・原語Statusを編集可能にし、Close/Task/Parentの帯は置かない。

## 下書きの整合性

入力可否と保存可否を分離する。背景GETは入力を無効にしない。各項目のbase B、draft D、server Sを比較し、D=BならSを採用、D=Sならclean、S=BならDを保持、それ以外はBとDを残して競合を表示する。本文の自動マージは行わない。担当者はlogin集合で比較。同じ項目の競合は明示選択まで保存を止める。IME中のリモート反映は変換終了後に行う。

保存操作はfresh GETを待ち、同じ完全な最新Issueのrevision/rawStatus/fingerprintに対する狭い差分だけ送る。サーバーのuncached preflight/readback、Issue DO queue/idempotency、公開確認を変更しない。送信中のみ入力を停止し、二重送信を防ぐ。書き込みの結果不明・部分保存は自動再送せず入力を保持。通常のGETだけでは保存停止を解除しない。mutation_outcome_unresolvedは管理者確認が必要で、復旧GETによる解除は不可。保存成功後の読取失敗は確定済み保存を失敗扱いにしない。

未保存差分がある時だけ破棄確認。IME中はEscape/保存を抑止。対象がscopeから外れた場合は下書きを保持して保存停止。背景同期は45秒/focus/onlineの既存経路を使用する。

## 検証上の限界

モックで競合・通信失敗・IME compositionイベント・Markdown roundtripを試験する。合成イベントは実OS日本語IMEを完全には再現しない。本番は閲覧と取消のみで、実IssueへQA目的の書き込みはしない。
