import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createHandler } from "./github.mjs";
import {
  currentSprintAssignmentWindow,
  currentSprintSelection,
  sprintAssignmentWindow,
} from "./sprint-boundary.mjs";
import { fixture, env, req } from "../tests/github-fixture.mjs";

const marker = (start) =>
  `<!-- idea-boost-sprint:v2 ${JSON.stringify({ schema_version: 2, timezone: "Asia/Tokyo", assignment_start_date: start })} -->`;
const milestone = (number = 10, changes = {}) => ({
  number,
  title: `Sprint ${number}`,
  description: marker("2026-10-28"),
  dueOn: "2026-11-04T00:00:00Z",
  state: "OPEN",
  closedAt: null,
  ...changes,
});
const previous = () =>
  milestone(9, {
    description: marker("2026-10-21"),
    dueOn: "2026-10-28T00:00:00Z",
  });
const catalog = () => [previous(), milestone()];
const selection = (rows, time) =>
  currentSprintSelection(
    rows.map((m) => ({
      ...m,
      hasAssignmentMetadata:
        m.description?.includes("idea-boost-sprint:") ?? false,
      assignmentWindow: currentSprintAssignmentWindow(m),
    })),
    Date.parse(time),
  );
const expected = {
  number: 10,
  title: "Sprint 10",
  policy: "sprint-v2-exclusive-jst",
  startAt: "2026-10-27T15:00:00.000Z",
  endAt: "2026-11-03T15:00:00.000Z",
};

test("current sprint switches at exact JST midnight, start inclusive and end exclusive", () => {
  assert.equal(
    selection(catalog(), "2026-10-27T14:59:59.999Z").currentSprint.number,
    9,
  );
  assert.deepEqual(selection(catalog(), "2026-10-27T15:00:00.000Z"), {
    currentSprint: expected,
    status: "current",
  });
  assert.equal(
    selection(catalog(), "2026-11-03T14:59:59.999Z").currentSprint.number,
    10,
  );
  assert.deepEqual(selection(catalog(), "2026-11-03T15:00:00.000Z"), {
    currentSprint: null,
    status: "none",
  });
});
for (const [name, rows, at] of [
  ["empty catalog", [], "2026-10-28T00:00:00Z"],
  ["all future", catalog(), "2026-10-20T00:00:00Z"],
  [
    "future gap",
    [previous(), milestone(10, { description: marker("2026-10-29") })],
    "2026-10-28T00:00:00Z",
  ],
  [
    "closed active window",
    [milestone(10, { state: "CLOSED", closedAt: "2026-10-28T00:00:00Z" })],
    "2026-10-28T00:00:00Z",
  ],
])
  test(`current sprint does not infer a current interval: ${name}`, () => {
    assert.deepEqual(selection(rows, at), {
      currentSprint: null,
      status: "none",
    });
  });
for (const [name, extra] of [
  ["open overlap", milestone(11)],
  ["closed overlap", milestone(11, { state: "CLOSED" })],
  [
    "unknown version",
    milestone(9, { description: marker("2026-10-21").replace(":v2", ":v3") }),
  ],
  [
    "malformed marker",
    milestone(9, { description: "idea-boost-sprint:v2 broken" }),
  ],
  [
    "unknown closed metadata",
    milestone(9, { state: "CLOSED", description: "idea-boost-sprint:v1 {}" }),
  ],
  ["open-ended overlap", milestone(9, { dueOn: null })],
  ["title mismatch", milestone(9, { title: "Sprint 99" })],
])
  test(`ambiguous catalog does not guess: ${name}`, () => {
    assert.deepEqual(selection([milestone(), extra], "2026-10-28T00:00:00Z"), {
      currentSprint: null,
      status: "unavailable",
    });
  });
test("unmarked old sprint/release milestones do not claim an interval", () => {
  const rows = [
    milestone(),
    milestone(1, { description: null }),
    milestone(2, { title: "Release", description: "説明" }),
  ];
  assert.deepEqual(selection(rows, "2026-10-28T00:00:00Z"), {
    currentSprint: expected,
    status: "current",
  });
});
test("overlaps outside now do not change the current assignment", () => {
  for (const [start, end] of [
    ["2026-10-01", "2026-10-08T00:00:00Z"],
    ["2026-11-04", "2026-11-11T00:00:00Z"],
  ]) {
    const rows = [
      milestone(),
      ...[11, 12].map((number) =>
        milestone(number, { description: marker(start), dueOn: end }),
      ),
    ];
    assert.deepEqual(selection(rows, "2026-10-28T00:00:00Z"), {
      currentSprint: expected,
      status: "current",
    });
  }
});
test("future open-ended v2 sprint does not hide the finite current sprint", () => {
  const future = milestone(11, {
    description: marker("2026-11-04"),
    dueOn: null,
  });
  assert.deepEqual(selection([...catalog(), future], "2026-10-28T00:00:00Z"), {
    currentSprint: expected,
    status: "current",
  });
});
test("open-ended v2 assignment starts exactly at JST midnight and has no inferred end", () => {
  const openEnded = milestone(10, { dueOn: null });
  assert.equal(sprintAssignmentWindow(openEnded), undefined);
  assert.deepEqual(selection([openEnded], "2026-10-27T14:59:59.999Z"), {
    currentSprint: null,
    status: "none",
  });
  for (const at of ["2026-10-27T15:00:00Z", "2027-01-01T00:00:00Z"])
    assert.deepEqual(selection([openEnded], at), {
      currentSprint: { ...expected, endAt: null },
      status: "current",
    });
});
test("closed open-ended assignment stays none and still conflicts with another active window", () => {
  const closed = milestone(9, { dueOn: null, state: "CLOSED" });
  assert.deepEqual(selection([closed], "2026-10-28T00:00:00Z"), {
    currentSprint: null,
    status: "none",
  });
  assert.deepEqual(selection([closed, milestone()], "2026-10-28T00:00:00Z"), {
    currentSprint: null,
    status: "unavailable",
  });
});
test("open-ended due does not bypass strict v2 metadata validation", () => {
  for (const changes of [
    { description: marker("2026-02-30") },
    { description: marker("2026-10-28").replace(":v2", ":v3") },
    { title: "Sprint 11" },
  ])
    assert.equal(
      currentSprintAssignmentWindow(milestone(10, { dueOn: null, ...changes })),
      undefined,
    );
});

function currentFixture({
  rows = catalog(),
  rewrite = () => {},
  clock = () => Date.parse("2026-10-28T00:00:00Z"),
} = {}) {
  const upstream = fixture({ milestones: rows });
  const handler = createHandler({
    crypto: webcrypto,
    now: clock,
    fetch: async (url, options) => {
      const input = options.body ? JSON.parse(options.body) : {},
        response = await upstream.fetch(url, options),
        body = await response.json();
      const result = await rewrite(input.query || "", body, input.variables);
      return result instanceof Response
        ? result
        : Response.json(body, { status: response.status });
    },
  });
  return {
    ...upstream,
    read: (path = "/api/current-sprint", config = {}) =>
      handler(req(path), { ...env, AUTH_MODE: "public-temporary", ...config }),
    handler,
  };
}

test("current endpoint returns explicit null end while finite history parser remains unchanged", async () => {
  const f = currentFixture({ rows: [milestone(10, { dueOn: null })] });
  const response = await f.read();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    currentSprint: { ...expected, endAt: null },
    status: "current",
    checkedAt: "2026-10-28T00:00:00.000Z",
  });
});

test("progressive endpoint reads only complete catalog bracketed by fresh public guards", async () => {
  const f = currentFixture();
  const response = await f.read();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    currentSprint: expected,
    status: "current",
    checkedAt: "2026-10-28T00:00:00.000Z",
  });
  assert.deepEqual(
    f.calls
      .filter((call) => call.parsed?.query)
      .map((call) => call.parsed.query.match(/query (\w+)/)[1]),
    ["PublicScope", "ObservationMilestones", "PublicScope"],
  );
  assert.equal(
    f.calls.filter(
      (call) => !call.parsed?.query && !call.url.includes("/access_tokens"),
    ).length,
    0,
  );
  assert.equal(
    f.calls.some(
      (call) =>
        call.method === "PATCH" || call.parsed?.query?.startsWith("mutation"),
    ),
    false,
  );
});
test("ordinary initial board still performs no milestone catalog query", async () => {
  const f = currentFixture();
  assert.equal((await f.read("/api/board")).status, 200);
  assert.equal(
    f.calls.some((call) =>
      call.parsed?.query?.includes("ObservationMilestones"),
    ),
    false,
  );
});
test("checkedAt and current selection use time after catalog and final guard, not request start", async () => {
  let clock = Date.parse("2026-10-27T14:59:59.999Z"),
    catalogRead = false;
  const f = currentFixture({
    clock: () => clock,
    rewrite(query) {
      if (query.includes("ObservationMilestones")) catalogRead = true;
      if (query.includes("PublicScope") && catalogRead)
        clock = Date.parse("2026-10-27T15:00:00Z");
    },
  });
  const body = await (await f.read()).json();
  assert.equal(body.currentSprint.number, 10);
  assert.equal(body.checkedAt, "2026-10-27T15:00:00.000Z");
});
test("endpoint preserves explicit none and unavailable rather than returning guessed Sprint", async () => {
  for (const [rows, status] of [
    [[], "none"],
    [[milestone(1, { description: "idea-boost-sprint:v3 {}" })], "unavailable"],
  ]) {
    const response = await currentFixture({ rows }).read();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, status);
    assert.equal(body.currentSprint, null);
  }
});
test("catalog pagination is complete before current sprint selection", async () => {
  const f = currentFixture({
    rewrite(query, body, variables) {
      if (!query.includes("ObservationMilestones")) return;
      body.data.repository.milestones = {
        totalCount: 2,
        nodes: [catalog()[variables.after ? 0 : 1]],
        pageInfo: {
          hasNextPage: !variables.after,
          endCursor: variables.after ? null : "next",
        },
      };
    },
  });
  const response = await f.read();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).currentSprint.number, 10);
  assert.equal(
    f.calls.filter((call) =>
      call.parsed?.query?.includes("ObservationMilestones"),
    ).length,
    2,
  );
});
for (const [name, rewrite] of [
  [
    "missing page",
    (body) => {
      body.data.repository.milestones.totalCount = 3;
    },
  ],
  [
    "over limit",
    (body) => {
      body.data.repository.milestones.totalCount = 101;
    },
  ],
  [
    "duplicate",
    (body) => {
      body.data.repository.milestones.nodes[1] =
        body.data.repository.milestones.nodes[0];
    },
  ],
  [
    "invalid state",
    (body) => {
      body.data.repository.milestones.nodes[0].state = "UNKNOWN";
    },
  ],
  [
    "missing description",
    (body) => {
      delete body.data.repository.milestones.nodes[0].description;
    },
  ],
])
  test(`incomplete catalog returns unavailable 503: ${name}`, async () => {
    const f = currentFixture({
      rewrite(query, body) {
        if (query.includes("ObservationMilestones")) rewrite(body);
      },
    });
    const response = await f.read();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "observation_incomplete",
      currentSprint: null,
      status: "unavailable",
      checkedAt: "2026-10-28T00:00:00.000Z",
    });
  });
for (const stage of [
  "before-repository",
  "before-project",
  "catalog",
  "after-repository",
  "after-project",
])
  test(`public guard revocation never exposes sprint: ${stage}`, async () => {
    let catalogRead = false;
    const f = currentFixture({
      rewrite(query, body) {
        if (query.includes("ObservationMilestones")) {
          catalogRead = true;
          if (stage === "catalog") body.data.repository.isPrivate = true;
        }
        if (
          query.includes("PublicScope") &&
          stage.startsWith(catalogRead ? "after" : "before")
        ) {
          if (stage.endsWith("repository"))
            body.data.repository.isPrivate = true;
          else body.data.organization.projectV2.public = false;
        }
      },
    });
    const response = await f.read();
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "scope_not_public",
    });
    if (stage.startsWith("before"))
      assert.equal(
        f.calls.some((call) =>
          call.parsed?.query?.includes("ObservationMilestones"),
        ),
        false,
      );
  });
for (const mode of ["http", "network", "graphql"])
  test(`upstream failure produces unavailable 503, not empty current: ${mode}`, async () => {
    const f = currentFixture({
      rewrite(query, body) {
        if (!query.includes("ObservationMilestones")) return;
        if (mode === "network") throw new TypeError("network failed");
        if (mode === "http")
          return Response.json({ message: "unavailable" }, { status: 503 });
        body.errors = [{ message: "denied" }];
      },
    });
    const response = await f.read();
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.status, "unavailable");
    assert.equal(body.currentSprint, null);
  });
test("current endpoint rejects parameters, unsupported methods, or missing principal before external reads", async () => {
  const f = currentFixture();
  for (const path of [
    "/api/current-sprint?milestone=9",
    "/api/current-sprint?repo=evil",
  ])
    assert.equal((await f.read(path)).status, 400);
  for (const method of ["POST", "HEAD"])
    assert.equal(
      (
        await f.handler(
          new Request("https://board.example/api/current-sprint", {
            method,
            headers: {
              origin: "https://board.example",
              "x-verified-user-id": "owner",
            },
          }),
          env,
        )
      ).status,
      405,
    );
  assert.equal(
    (
      await f.handler(
        new Request("https://board.example/api/current-sprint"),
        env,
      )
    ).status,
    401,
  );
  assert.equal(f.calls.length, 0);
});
