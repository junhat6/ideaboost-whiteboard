import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("semantic reading/status/progress tokens match DESIGN and obsolete green alias is gone", async () => {
  const [design, css] = await Promise.all([
    readFile("DESIGN.md", "utf8"),
    readFile("web/styles.css", "utf8"),
  ]);
  for (const [token, key] of Object.entries({
    canvas: "canvas",
    surface: "surface",
    soft: "surface-soft",
    ink: "ink",
    muted: "muted",
    line: "line",
    accent: "primary",
    "accent-hover": "primary-hover",
    selected: "selected",
    "input-border": "input-border",
    "progress-track": "progress-track",
    "progress-pending": "progress-pending",
    "status-selected": "status-selected",
    "status-gray": "status-gray",
    "status-blue": "status-blue",
    "status-green": "status-green",
    "status-yellow": "status-yellow",
    "status-orange": "status-orange",
    "status-red": "status-red",
    "status-purple": "status-purple",
    "status-pink": "status-pink",
  })) {
    const expected = design.match(
      new RegExp(`^  ${key}: "(#[a-f0-9]+)"`, "mi"),
    )?.[1];
    const actual = css.match(
      new RegExp(`--${token}:\\s*(#[a-f0-9]+);`, "i"),
    )?.[1];
    const expand = (x: string | undefined) =>
      x?.length === 4 ? "#" + [...x.slice(1)].map((c) => c + c).join("") : x;
    assert.equal(expand(actual), expand(expected), token);
    assert.ok(actual, token);
  }
  assert.doesNotMatch(css, /--green\s*:/);
  assert.match(css, /--progress-complete:\s*var\(--accent\)/);
});
