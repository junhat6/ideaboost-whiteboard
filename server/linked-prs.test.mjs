import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLinkedPrs } from "./linked-prs.mjs";
const pr = (state = "OPEN", isDraft = false) => ({
  number: 836,
  title: "正式な関連PR",
  url: "https://github.com/engineer-first/idea-boost/pull/836",
  state,
  isDraft,
  repository: { nameWithOwner: "engineer-first/idea-boost", isPrivate: false },
});
test("linked PR states and pagination retain canonical public scope only", () => {
  for (const [state, draft] of [
    ["OPEN", false],
    ["OPEN", true],
    ["MERGED", false],
    ["CLOSED", false],
  ]) {
    const r = normalizeLinkedPrs({
      nodes: [
        pr(state, draft),
        {
          ...pr(),
          repository: {
            isPrivate: true,
            nameWithOwner: "engineer-first/idea-boost",
          },
        },
        {
          ...pr(),
          repository: { isPrivate: false, nameWithOwner: "other/repo" },
        },
      ],
      pageInfo: { hasNextPage: true, endCursor: "next==" },
    });
    assert.equal(r.prs.length, 1);
    assert.equal(r.prs[0].state, state);
    assert.equal(r.prs[0].isDraft, draft);
    assert.equal(r.nextCursor, "next==");
  }
});
test("linked PR malformed response and unsafe URLs fail closed", () => {
  for (const connection of [
    null,
    { nodes: [], pageInfo: { hasNextPage: true } },
    {
      nodes: [{ ...pr(), url: "https://github.com.evil/pull/836" }],
      pageInfo: { hasNextPage: false },
    },
  ])
    assert.throws(() => normalizeLinkedPrs(connection));
});
