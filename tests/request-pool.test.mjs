import assert from "node:assert/strict";
import { test } from "node:test";
import { configureRequest } from "../scripts/requests.js";

test("the GM's dice adjustments survive serialization on both kinds of card", () => {
    const mods = { boost: 2, setback: 1, force: 1, upgradeAbility: 1, upgradeDifficulty: 2 };
    const opts = { ffgDifficulty: 0, ffgModifiers: mods };
    const skill = { type: "skill", key: "perception" };
    const normal = { what: "savingthrow", requests: [skill], options: opts };
    configureRequest(normal);
    assert.deepEqual(JSON.parse(JSON.stringify(skill.ffgModifiers)), mods);
    assert.equal(skill.ffgDifficulty, 0);
    assert.equal(normal.dc, 1);
    const numeric = { type: "dice", key: "1d6" };
    const sides = { what: "contestedroll", options: opts, tokens: [
        { requests: [{ type: "skill", key: "stealth" }, numeric] },
        { requests: [{ type: "skill", key: "perception" }] }
    ] };
    configureRequest(sides);
    const [left, right] = sides.tokens.map(token => token.requests[0]);
    assert.deepEqual(left.ffgModifiers, mods);
    assert.deepEqual(right.ffgModifiers, mods);
    assert.notEqual(left.ffgModifiers, right.ffgModifiers);
    assert.notEqual(left.ffgModifiers, opts.ffgModifiers);
    assert.equal(right.ffgDifficulty, 0);
    assert.equal(sides.dc, undefined);
    assert.deepEqual(numeric, { type: "dice", key: "1d6" });
});

test("reusing a previously requested skill clears prior modifiers when the GM resets the pool", () => {
    const skill = { type: "skill", key: "perception", ffgModifiers: { boost: 3 } };
    configureRequest({ what: "savingthrow", options: { ffgModifiers: {} }, requests: [skill] });
    assert.equal(skill.ffgModifiers?.boost ?? 0, 0);
});
