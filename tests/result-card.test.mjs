import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCardRow } from "../scripts/results.js";

const request = { type: "skill", key: "perception", name: "Perception", ffgDifficulty: 3 };
const flags = { what: "savingthrow", rollmode: "roll", requests: [request], dc: "3", showdc: true };
const viewer = { isGM: false, owns: e => e.id === "a" };
const symbols = { success: 1, failure: 0, advantage: 0, threat: 2, triumph: 0, despair: 0, light: 0, dark: 0 };
function rolled(id, counts = symbols) {
  return { id, showtoken: true, reveal: true, roll: { options: { starwarsffgTokenbar: counts } } };
}

test("a successful legacy check can miss a custom threshold; its dice cannot be reconstructed", () => {
  const row = describeCardRow(flags, { ...rolled("a"), passed: false }, viewer);
  assert.equal(row.state, "success");
  assert.equal(row.difficulty, 3);
  assert.deepEqual(row.requests, [request]);
  assert.equal(row.outcome.netSuccess, 1);
  assert.equal(row.outcome.pool, null);
  assert.deepEqual(row.threshold, { value: 3, met: false });
  assert.equal(describeCardRow({ ...flags, showdc: false }, rolled("a"), viewer).threshold, null);
});

test("zero successes fails independently of advantage; the default threshold is implicit", () => {
  const row = describeCardRow({ ...flags, dc: "1" }, rolled("a", { ...symbols, success: 0, advantage: 2, threat: 0 }), viewer);
  assert.equal(row.state, "failure");
  assert.equal(row.outcome.netAdvantage, 2);
  assert.equal(row.threshold, null);
});

test("pending, hidden, unrevealed, numeric and hidden-token rows never expose a narrative result", () => {
  assert.equal(describeCardRow(flags, { id: "a" }, viewer).state, "pending");
  assert.equal(describeCardRow(flags, { ...rolled("a"), error: true }, viewer).state, "error");
  for (const [mode, id] of [["blindroll","a"], ["gmroll","b"]]) {
    const row = describeCardRow({ ...flags, rollmode: mode }, rolled(id), viewer);
    assert.equal(row?.outcome ?? null, null);
    assert.equal(row?.threshold ?? null, null);
  }
  const unrevealed = describeCardRow(flags, { ...rolled("a"), reveal: false }, { ...viewer, isGM: true });
  assert.equal(unrevealed.state, "unrevealed");
  assert.equal(unrevealed.outcome, null);
  assert.equal(describeCardRow(flags, { ...rolled("a"), showtoken: false }, viewer), null);
  assert.equal(describeCardRow({ ...flags, requests: [{ type: "dice", key: "1d6" }] }, { id: "a" }, viewer), null);
});

test("contest reports an independently adjudicated winner or tie only when both results can be seen", () => {
  const [a,b] = ["a", "b"].map(id => ({ ...rolled(id), requests: [request] }));
  const contest = { what: "contestedroll", rollmode: "roll", tokena: a, tokenb: b };
  assert.equal(describeCardRow(contest, a, viewer).contest, "tied");
  assert.equal(describeCardRow({ ...contest, tokenb: { ...b, reveal: false } }, a, viewer).contest, null);
  assert.equal(describeCardRow({ ...contest, tokenb: { ...b, showtoken: false } }, a, viewer).contest, null);
  assert.equal(describeCardRow({ ...contest, rollmode: "gmroll" }, a, viewer).contest, null);
  a.passed = "won"; b.passed = "failed";
  assert.equal(describeCardRow(contest, a, viewer).contest, "won");
  assert.equal(describeCardRow(contest, b, viewer).contest, "lost");
});
