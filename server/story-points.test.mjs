import { test } from "node:test";
import assert from "node:assert/strict";
import { publicPbiStoryPoints } from "./story-points.mjs";
const read = (value, extra = {}) =>
  publicPbiStoryPoints({
    issueType: "PBI",
    value,
    fieldVerified: true,
    fieldPublic: true,
    ...extra,
  });
test("public canonical PBI points retain the requested scale and optional unset value", () => {
  for (const value of [0.1, 1, 2, 3, 5, 8, 13])
    assert.equal(read(value), value);
  assert.equal(read(null), null);
  // External canonical values are not silently rounded to the suggested scale.
  assert.equal(read(4), 4);
});
test("unverified or nonpublic fields and Task values never enter the public projection", () => {
  for (const fieldPublic of [false, undefined, null, "PUBLIC"])
    assert.equal(read(13, { fieldPublic }), undefined);
  for (const fieldVerified of [false, undefined, null])
    assert.equal(read(13, { fieldVerified }), undefined);
  for (const issueType of ["Task", null, "競合調査"])
    assert.equal(read(13, { issueType }), undefined);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify({ storyPoints: read(13, { fieldPublic: false }) }),
    ),
    {},
  );
});
test("missing and malformed numeric values stay unavailable rather than becoming zero or an estimate", () => {
  for (const value of [
    undefined,
    "0.1",
    "8",
    NaN,
    Infinity,
    -Infinity,
    {},
    [],
    false,
  ])
    assert.equal(read(value), undefined);
});

import { readPublicPbiStoryPoints } from "./story-points.mjs";
const definition = {
  id: 42,
  name: "Story points",
  data_type: "number",
  visibility: "all",
};
const options = (extra = {}) => ({
  approved: true,
  fieldId: 42,
  pbis: [{ type: "PBI", number: 1 }],
  assertScope: async () => true,
  getDefinitions: async () => [definition],
  getValues: async () => ({
    data: [{ issue_field_id: 42, data_type: "number", value: 0.1 }],
    hasNextPage: false,
  }),
  ...extra,
});
test("late reader requires approval, exact ID, PBI scope and public numeric definition", async () => {
  for (const extra of [
    { approved: false },
    { fieldId: undefined },
    { pbis: [{ type: "Task", number: 1 }] },
    { getDefinitions: async () => [] },
    {
      getDefinitions: async () => [
        { ...definition, visibility: "organization_members_only" },
      ],
    },
    { getDefinitions: async () => [{ ...definition, data_type: "text" }] },
    { getDefinitions: async () => [{ ...definition, name: "Effort" }] },
    { assertScope: async () => false },
  ]) {
    let reads = 0;
    assert.deepEqual(
      await readPublicPbiStoryPoints(
        options({
          ...extra,
          getValues: async () => {
            reads++;
          },
        }),
      ),
      { values: {} },
    );
    assert.equal(reads, 0);
  }
  assert.deepEqual(await readPublicPbiStoryPoints(options()), {
    values: { 1: 0.1 },
  });
});
test("pagination must finish, malformed and failed reads are omitted, unset is null", async () => {
  assert.deepEqual(
    await readPublicPbiStoryPoints(
      options({
        getValues: async (_, { page }) => ({
          data:
            page === 2
              ? [{ issue_field_id: 42, data_type: "number", value: 13 }]
              : [],
          hasNextPage: page === 1,
        }),
      }),
    ),
    { values: { 1: 13 } },
  );
  assert.deepEqual(
    await readPublicPbiStoryPoints(
      options({ getValues: async () => ({ data: [], hasNextPage: false }) }),
    ),
    { values: { 1: null } },
  );
  for (const getValues of [
    async () => {
      throw new Error("403");
    },
    async () => ({ data: [], hasNextPage: true }),
    async () => ({ data: [null], hasNextPage: false }),
    async () => ({ data: [], hasNextPage: null }),
    async () => ({
      data: [{ issue_field_id: 42, data_type: "number", value: "8" }],
      hasNextPage: false,
    }),
  ])
    assert.deepEqual(await readPublicPbiStoryPoints(options({ getValues })), {
      values: {},
    });
});
test("private transition or final visibility failure removes all late results", async () => {
  for (const fail of [false, true]) {
    let calls = 0;
    assert.deepEqual(
      await readPublicPbiStoryPoints(
        options({
          getDefinitions: async () => {
            if (++calls === 1) return [definition];
            if (fail) throw new Error("timeout");
            return [{ ...definition, visibility: "organization_members_only" }];
          },
        }),
      ),
      { values: {} },
    );
  }
});
test("at most three PBI reads run concurrently and the original board is untouched", async () => {
  const pbis = Array.from({ length: 6 }, (_, n) =>
    Object.freeze({ type: "PBI", number: n + 1 }),
  );
  let active = 0,
    peak = 0;
  const result = await readPublicPbiStoryPoints(
    options({
      pbis,
      getValues: async (number) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return {
          data: [{ issue_field_id: 42, data_type: "number", value: number }],
          hasNextPage: false,
        };
      },
    }),
  );
  assert.equal(peak, 3);
  assert.equal(Object.keys(result.values).length, 6);
  assert.equal(pbis[0].storyPoints, undefined);
});
