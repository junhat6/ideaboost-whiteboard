import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  createMeetingHandler,
  compactTranscript,
  normalizeDigest,
  MAX_SOURCE_CHARS,
} from "./meetings.mjs";
import { env as githubEnv } from "../tests/github-fixture.mjs";

const ORIGIN = "https://board.example";
const SECRET_LINE = "社外秘の発言そのもの";
const teamEnv = {
  ...githubEnv,
  MEETINGS_AI_ENABLED: "true",
  ANTHROPIC_API_KEY: "test-key",
};
const loggerEnv = { ...teamEnv, MEETINGS_LOGGER_READ_ENABLED: "true" };
const digestJson = {
  headline: "企業参加の形を決めた",
  overview: "スポンサーと参加企業に分けた。",
  topics: [
    {
      title: "企業向け案内",
      summary: "導線を追加する",
      points: ["ヘッダーに導線"],
      state: "decided",
      pbis: [7, 999],
      evidence: ["chunk-092200", "chunk-000000"],
    },
  ],
  decisions: [
    {
      text: "スポンサーと参加企業に分ける",
      topic: 0,
      needsConfirmation: false,
      evidence: ["chunk-092200"],
    },
  ],
  actions: [
    {
      text: "フォームを直す",
      owner: "",
      due: "2026-11-22",
      topic: 5,
      pbis: [7],
      evidence: [],
    },
  ],
  openQuestions: [{ text: "最低金額", topic: -1, evidence: [] }],
  timeline: [
    { chunk: "chunk-093000", label: "フォーム確認" },
    { chunk: "chunk-092200", label: "審査員の連絡" },
    { chunk: "chunk-nope00", label: "存在しない" },
  ],
};
const transcriptAm = `# 午前\n\n## 本文\n\n<a id="chunk-092200"></a>\n### 09:22:00–09:26:59\n\n[聞き取り不確か 0.00–28.08秒] 審査員の${SECRET_LINE}\n\n<a id="chunk-093000"></a>\n### 09:30:00–09:34:59\n\nフォームを確認\n\n<a id="chunk-094000"></a>\n### 09:40:00–09:44:59\n\n[聞き取り不確か 0.00–30.00秒]\n`;

function harness({
  aiResponse = digestJson,
  stopReason = "end_turn",
  aiStatus = 200,
  tokenStatus = 201,
  hold = null,
} = {}) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const body =
      init.body ??
      (typeof input === "object" && input.body ? await input.text() : null);
    calls.push({ url, init, body });
    if (url.includes("/access_tokens"))
      return Response.json(
        { token: "logger-token", expires_at: "2099-01-01T00:00:00Z" },
        { status: tokenStatus },
      );
    if (url.startsWith("https://api.github.com/repos/")) {
      const path = new URL(url).pathname;
      if (path.endsWith("/minutes/2026/11"))
        return Response.json([
          { type: "file", name: "2026-11-19.md" },
          { type: "file", name: "2026-11-20.md" },
          { type: "file", name: "README.md" },
        ]);
      if (path.endsWith("/minutes/2026/10"))
        return new Response(null, { status: 404 });
      if (path.endsWith("/2026-11-20.md"))
        return new Response("# 2026-11-20 議事録\n決まったこと");
      if (path.endsWith("/2026-11-20-am.md")) return new Response(transcriptAm);
      return new Response(null, { status: 404 });
    }
    if (url.startsWith("https://api.anthropic.com/")) {
      if (hold) await hold;
      if (aiStatus !== 200)
        return Response.json(
          { type: "error", error: { type: "api_error", message: "x" } },
          { status: aiStatus },
        );
      return Response.json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        stop_reason: stopReason,
        content: [{ type: "text", text: JSON.stringify(aiResponse) }],
        usage: { input_tokens: 1200, output_tokens: 300 },
      });
    }
    throw new Error("unexpected " + url);
  };
  const handle = createMeetingHandler({
    fetch,
    crypto: webcrypto,
    now: () => Date.parse("2026-11-22T03:00:00Z"),
  });
  return { calls, handle };
}
const get = (path, headers = {}) =>
  new Request(ORIGIN + path, {
    headers: { "x-verified-user-id": "u1", ...headers },
  });
const post = (body, headers = {}) =>
  new Request(ORIGIN + "/api/meetings/digest", {
    method: "POST",
    headers: {
      "x-verified-user-id": "u1",
      origin: ORIGIN,
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const pbis = [{ number: 7, title: "企業向けページ" }];

test("public-temporary mode never exposes meeting routes or calls upstream", async () => {
  const { calls, handle } = harness();
  for (const request of [
    get("/api/meetings"),
    post({ text: "議事録", pbis }),
  ]) {
    const r = await handle(request, {
      ...loggerEnv,
      AUTH_MODE: "public-temporary",
    });
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { ok: false, error: "not_found" });
  }
  assert.equal(calls.length, 0);
});

test("unconfigured AI fails closed and reports capability without reading GitHub", async () => {
  const { calls, handle } = harness();
  const list = await handle(get("/api/meetings"), githubEnv);
  assert.deepEqual(await list.json(), {
    ok: true,
    ai: false,
    logger: false,
    meetings: [],
  });
  const r = await handle(post({ text: "議事録", pbis }), githubEnv);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "meeting_ai_not_configured");
  const noLogger = await handle(post({ date: "2026-11-20", pbis }), teamEnv);
  assert.equal(noLogger.status, 503);
  assert.equal((await noLogger.json()).error, "meeting_logger_not_configured");
  assert.equal(calls.length, 0);
});

test("requests need the worker principal and same origin", async () => {
  const { calls, handle } = harness();
  const anon = await handle(new Request(ORIGIN + "/api/meetings"), teamEnv);
  assert.equal(anon.status, 401);
  const cross = await handle(
    post({ text: "議事録", pbis }, { origin: "https://evil.example" }),
    teamEnv,
  );
  assert.equal(cross.status, 403);
  assert.equal(calls.length, 0);
});

test("meeting-logger reads use a separate contents:read token for that repo only", async () => {
  const { calls, handle } = harness();
  const r = await handle(get("/api/meetings"), loggerEnv);
  const data = await r.json();
  assert.deepEqual(
    data.meetings.map((m) => m.date),
    ["2026-11-20", "2026-11-19"],
  );
  const tokenCall = calls.find((c) => c.url.includes("/access_tokens"));
  assert.deepEqual(JSON.parse(tokenCall.body), {
    repositories: ["meeting-logger"],
    permissions: { contents: "read" },
  });
  assert.ok(
    calls
      .filter((c) => c.url.includes("/repos/"))
      .every((c) =>
        c.url.includes("/repos/engineer-first/meeting-logger/contents/"),
      ),
  );
});

test("logger token denial is reported as unavailable, never as an empty archive", async () => {
  const { handle } = harness({ tokenStatus: 422 });
  const r = await handle(get("/api/meetings"), loggerEnv);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "meeting_source_unavailable");
});

test("digest with transcript keeps only verifiable PBI and evidence links", async () => {
  const { calls, handle } = harness();
  const r = await handle(
    post({ date: "2026-11-20", transcript: true, pbis }),
    loggerEnv,
  );
  assert.equal(r.status, 200);
  const data = await r.json();
  const { digest } = data;
  assert.deepEqual(digest.topics[0].pbis, [7]);
  assert.deepEqual(
    digest.topics[0].evidence.map((e) => e.chunk),
    ["chunk-092200"],
  );
  assert.match(
    digest.topics[0].evidence[0].url,
    /meeting-logger\/blob\/main\/docs\/meeting-logs\/transcripts\/2026\/11\/2026-11-20-am\.md#chunk-092200$/,
  );
  assert.equal(
    digest.actions[0].topic,
    -1,
    "out-of-range topic index is dropped",
  );
  assert.deepEqual(
    digest.timeline.map((t) => t.chunk),
    ["chunk-092200", "chunk-093000"],
    "timeline is chronological and limited to real chunks",
  );
  assert.equal(
    data.source.transcripts.length,
    1,
    "missing pm transcript is skipped",
  );
  const ai = calls.find((c) => c.url.startsWith("https://api.anthropic.com/"));
  const sent = JSON.parse(ai.body);
  assert.equal(sent.output_config.format.type, "json_schema");
  assert.equal(sent.fallbacks, "default");
  const userText = sent.messages[0].content;
  assert.ok(
    !userText.includes("聞き取り不確か"),
    "uncertain-recognition markers are removed",
  );
  assert.ok(userText.includes("#7 企業向けページ"));
  assert.ok(!userText.includes("chunk-094000"), "empty chunks are not sent");
});

test("pasted text works without the meeting-logger permission", async () => {
  const { calls, handle } = harness();
  const r = await handle(post({ text: "決まったこと: A", pbis }), teamEnv);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.source.kind, "pasted");
  assert.deepEqual(data.digest.timeline, []);
  assert.ok(calls.every((c) => !c.url.startsWith("https://api.github.com/")));
});

test("oversized input is refused instead of silently truncated", async () => {
  const { calls, handle } = harness();
  const r = await handle(
    post({ text: "あ".repeat(MAX_SOURCE_CHARS + 1), pbis }),
    teamEnv,
  );
  assert.equal(r.status, 413);
  assert.equal((await r.json()).error, "meeting_input_too_long");
  assert.equal(calls.length, 0);
});

test("invalid request shapes are rejected before any upstream call", async () => {
  const { calls, handle } = harness();
  for (const body of [
    "not json",
    { pbis },
    { date: "2026-11-20", text: "x" },
    { date: "../../etc", pbis },
    { text: "x", transcript: true },
    { text: "x", extra: 1 },
  ]) {
    const r = await handle(post(body), loggerEnv);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test("incomplete or refused AI output is an error that never echoes meeting text", async () => {
  for (const options of [
    { stopReason: "max_tokens" },
    { stopReason: "refusal" },
    { aiResponse: { nope: true } },
    { aiStatus: 500 },
  ]) {
    const { handle } = harness(options);
    const r = await handle(post({ text: SECRET_LINE, pbis }), teamEnv);
    assert.equal(r.status, 502, JSON.stringify(options));
    const raw = await r.text();
    assert.ok(!raw.includes(SECRET_LINE));
    assert.match(JSON.parse(raw).error, /^meeting_ai_(incomplete|failed)$/);
  }
});

test("a second digest from the same person while one runs is refused", async () => {
  let release;
  const hold = new Promise((r) => (release = r));
  const { handle } = harness({ hold });
  const first = handle(post({ text: "議事録", pbis }), teamEnv);
  await new Promise((r) => setTimeout(r, 10));
  const second = await handle(post({ text: "議事録", pbis }), teamEnv);
  assert.equal(second.status, 409);
  release();
  assert.equal((await first).status, 200);
  const third = await handle(post({ text: "議事録", pbis }), teamEnv);
  assert.equal(third.status, 200, "lock is released after completion");
});

test("compactTranscript and normalizeDigest are defensive about shape", () => {
  const chunks = compactTranscript(transcriptAm, "am");
  assert.deepEqual(
    chunks.map((c) => [c.id, c.from, c.to]),
    [
      ["chunk-092200", "09:22", "09:26"],
      ["chunk-093000", "09:30", "09:34"],
    ],
  );
  assert.equal(normalizeDigest(null, {}), null);
  assert.equal(normalizeDigest({ headline: "", topics: [] }, {}), null);
});
