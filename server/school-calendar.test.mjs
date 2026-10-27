import test from "node:test";
import assert from "node:assert/strict";
import {
  todayJst,
  validSchoolSelection,
  weekdayProposal,
} from "../web/school-calendar.js";

test("学校日の今日と候補はJSTで求め、現在日から期日までの平日だけを返す", () => {
  const now = Date.parse("2026-10-23T15:00:00Z");
  assert.equal(todayJst(now), "2026-10-24");
  assert.deepEqual(weekdayProposal("2026-10-28T00:00:00Z", now), [
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
  ]);
  assert.deepEqual(
    weekdayProposal("2026-10-27T15:00:00Z", Date.parse("2026-10-27T15:00:00Z")),
    ["2026-10-28"],
  );
});

test("不明・過去・長すぎる期日は自動選択せず空の提案にする", () => {
  const now = Date.parse("2026-10-27T00:00:00Z");
  for (const due of [
    null,
    "",
    "invalid",
    "2026-10-26",
    "2027-05-01",
    "2027-02-01",
  ])
    assert.deepEqual(weekdayProposal(due, now), []);
  assert.deepEqual(weekdayProposal("2026-10-30", NaN), []);
});

test("候補は月をまたぎ、週末を飛ばすが祝日を勝手に除外しない", () => {
  assert.deepEqual(
    weekdayProposal("2026-11-04", Date.parse("2026-10-30T03:00:00Z")),
    ["2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04"],
  );
});

test("独立した学校日は実在日・一意昇順・60日/180日期間で検証する", () => {
  assert.equal(validSchoolSelection([]), true);
  assert.equal(
    validSchoolSelection(["2026-10-21", "2026-10-23", "2026-11-04"]),
    true,
  );
  assert.equal(validSchoolSelection(["2028-02-29"]), true);
  for (const invalid of [
    ["2026-02-29"],
    ["2026-13-01"],
    ["2026-10-21", "2026-10-21"],
    ["2026-10-23", "2026-10-21"],
    ["2026-01-01", "2026-07-01"],
    Array.from({ length: 61 }, (_, i) =>
      new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    ),
  ])
    assert.equal(validSchoolSelection(invalid), false);
  assert.equal(validSchoolSelection(["2026-01-01", "2026-06-30"]), true);
});
