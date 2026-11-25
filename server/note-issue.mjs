/**
 * 付箋を GitHub Issue にする要求の検証と本文の組み立て（ADR 019）。
 * GitHub を呼ばない純粋な関数だけを置き、Worker・DO・試験で同じ判定を使う。
 * 本文の形は engineer-first/idea-boost の docs/team/issue-writing.md に合わせる:
 * PBI は見出しなしの冒頭ストーリー → `## Why` → 任意の欄、Task は `## Why` → 任意の欄。
 */
export const NOTE_ISSUE_TYPES = ["Task", "PBI"];
/** 作るときに選べる Status。完了・見送りで作ることはない。 */
export const NOTE_ISSUE_STATUSES = [
  "未整理",
  "壁打ち中",
  "着手可能",
  "作業中",
  "レビュー中",
];
export const NOTE_ISSUE_TITLE_MAX = 256;
export const NOTE_ISSUE_FIELD_MAX = 10000;
const NOTE_ID = /^n_[a-z0-9]{8,32}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{16,100}$/;

/** 種類ごとの欄。required は GitHub の Issue Forms の必須欄と同じ。 */
export const NOTE_ISSUE_FIELDS = {
  PBI: [
    { key: "story", heading: null, required: true },
    { key: "why", heading: "Why", required: true },
    { key: "experience", heading: "ユーザーに提供する体験", required: false },
    { key: "notes", heading: "補足", required: false },
  ],
  Task: [
    { key: "why", heading: "Why", required: true },
    { key: "how", heading: "How", required: false },
    { key: "acceptance", heading: "作業完了条件", required: false },
    { key: "notes", heading: "関連Issue・補足", required: false },
  ],
};
const ALL_KEYS = new Set([
  "requestId",
  "noteId",
  "type",
  "title",
  "status",
  "parent",
  ...Object.values(NOTE_ISSUE_FIELDS).flatMap((f) => f.map((x) => x.key)),
]);

function fail(code) {
  const e = new Error(code);
  e.code = code;
  throw e;
}

/** 欄の文。改行は残し、CRLF をそろえ、制御文字を除く。空なら ""。 */
function text(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") fail("invalid_fields");
  return (
    value
      .replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, "")
      .trim()
  );
}

/**
 * 要求を検証し、正規化した値を返す。不正なら code 付きの Error を投げる。
 * 種類に無い欄（Task の story など）は受け付けない（黙って捨てない）。
 */
export function validateNoteIssue(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("invalid_fields");
  if (Object.keys(v).some((k) => !ALL_KEYS.has(k))) fail("invalid_fields");
  if (typeof v.requestId !== "string" || !REQUEST_ID.test(v.requestId))
    fail("invalid_request_id");
  if (typeof v.noteId !== "string" || !NOTE_ID.test(v.noteId))
    fail("invalid_note");
  if (!NOTE_ISSUE_TYPES.includes(v.type)) fail("invalid_type");
  const fields = NOTE_ISSUE_FIELDS[v.type];
  const allowed = new Set(fields.map((f) => f.key));
  for (const k of Object.keys(v))
    if (
      !["requestId", "noteId", "type", "title", "status", "parent"].includes(
        k,
      ) &&
      !allowed.has(k)
    )
      fail("invalid_fields");
  const title =
    typeof v.title === "string" ? v.title.replace(/\s+/g, " ").trim() : "";
  if (!title || title.length > NOTE_ISSUE_TITLE_MAX) fail("invalid_title");
  if (!NOTE_ISSUE_STATUSES.includes(v.status)) fail("invalid_status");
  let parent = null;
  if (v.parent !== undefined && v.parent !== null) {
    if (v.type !== "Task") fail("parent_task_only");
    if (!Number.isSafeInteger(v.parent) || v.parent < 1) fail("invalid_parent");
    parent = v.parent;
  }
  const values = {};
  for (const f of fields) {
    const value = text(v[f.key]);
    if (value.length > NOTE_ISSUE_FIELD_MAX) fail("field_too_long");
    if (f.required && !value) fail("required_" + f.key);
    values[f.key] = value;
  }
  return {
    requestId: v.requestId,
    noteId: v.noteId,
    type: v.type,
    title,
    status: v.status,
    parent,
    values,
  };
}

/** 検証済みの値から Issue 本文（Markdown）を作る。空の任意欄は見出しごと出さない。 */
export function buildNoteIssueBody({ type, values }) {
  return NOTE_ISSUE_FIELDS[type]
    .filter((f) => values[f.key])
    .map((f) =>
      f.heading ? `## ${f.heading}\n\n${values[f.key]}` : values[f.key],
    )
    .join("\n\n");
}
