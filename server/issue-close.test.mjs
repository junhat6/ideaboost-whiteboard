import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  env,
  req,
  patch,
  parentFingerprint,
} from "../tests/github-fixture.mjs";

const closePatch = (extra = {}) => {
  const input = patch({ close: true, ...extra });
  delete input.title;
  return input;
};
const writes = (f) =>
  f.calls.filter(
    (c) => c.method === "PATCH" || c.parsed?.query?.startsWith("mutation"),
  );

test("明示closeはTask/PBIのIssue状態だけを変更し、Project Statusを維持する", async () => {
  for (const number of [1, 2]) {
    const f = fixture({ parentInProject: true, initialStatus: "作業中" });
    const input = closePatch({
      expectedStatus: number === 1 ? "レビュー中" : "作業中",
      ...(number === 1 ? { expectedFingerprint: parentFingerprint } : {}),
    });
    const response = await f.handler(req(`/api/issues/${number}`, input), env);
    assert.equal(response.status, 200);
    const { issue } = await response.json();
    assert.equal(issue.state, "CLOSED");
    assert.equal(issue.stateReason, "COMPLETED");
    assert.equal(issue.status, input.expectedStatus);
    assert.deepEqual(
      writes(f).map((c) => c.parsed),
      [{ state: "closed", state_reason: "completed" }],
    );
    await f.handler(req(`/api/issues/${number}`, input), env);
    assert.equal(writes(f).length, 1);
  }
});

test("closeはtrueと完全な既知state前提だけを受け付ける", async () => {
  for (const extra of [
    { close: false },
    { close: "true" },
    { close: null },
    { expectedState: undefined },
    { expectedStateReason: undefined },
    { expectedStateReason: "UNKNOWN" },
    { state: "OPEN" },
  ]) {
    const f = fixture();
    const response = await f.handler(
      req("/api/issues/2", closePatch(extra)),
      env,
    );
    assert.equal(response.status, 400);
    assert.equal(writes(f).length, 0);
  }
});

test("closeのstate/reason/revision/Status/fingerprint競合は書込前に拒否する", async () => {
  for (const change of [
    { expectedState: "CLOSED" },
    { expectedStateReason: "REOPENED" },
    { expectedRevision: "2026-10-25T00:00:00Z" },
    { expectedStatus: "完了" },
    { expectedFingerprint: "0".repeat(64) },
  ]) {
    const f = fixture();
    assert.equal(
      (await f.handler(req("/api/issues/2", closePatch(change)), env)).status,
      409,
    );
    assert.equal(writes(f).length, 0);
  }
});

test("既存Closedは理由を上書きせず、明示closeでも再PATCHしない", async () => {
  const f = fixture({ initialStatus: "作業中" });
  Object.assign(f.issue, { state: "CLOSED", stateReason: "NOT_PLANNED" });
  const response = await f.handler(
    req(
      "/api/issues/2",
      closePatch({
        expectedState: "CLOSED",
        expectedStateReason: "NOT_PLANNED",
        expectedStatus: "作業中",
      }),
    ),
    env,
  );
  assert.equal(response.status, 200);
  const { issue } = await response.json();
  assert.equal(issue.stateReason, "NOT_PLANNED");
  assert.equal(issue.status, "作業中");
  assert.equal(writes(f).length, 0);
});

test("closeの既知失敗と結果不明を区別し、どちらも自動再送しない", async () => {
  for (const uncertain of [false, true]) {
    const f = fixture(
      uncertain ? { closeUncertain: true } : { closeFailure: true },
    );
    const response = await f.handler(req("/api/issues/2", closePatch()), env);
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.ambiguous, uncertain);
    assert.equal(result.issue.status, null);
    assert.equal(result.issue.state, uncertain ? "CLOSED" : "OPEN");
    await f.handler(req("/api/issues/2", closePatch()), env);
    assert.equal(writes(f).length, 1);
  }
});

test("closeもOrigin/対象scopeの認可を省略しない", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.handler(
        req("/api/issues/2", closePatch(), {
          origin: "https://other.example",
        }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(
    (await f.handler(req("/api/issues/99", closePatch()), env)).status,
    404,
  );
  assert.equal(writes(f).length, 0);
});
