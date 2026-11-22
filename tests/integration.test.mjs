import assert from "node:assert/strict";
import { test } from "node:test";
import { canShowResult } from "../scripts/results.js";
import { configureRequest, difficultyValue, findActorSkill, skillKey } from "../scripts/requests.js";

test("skill keys survive TokenBar string parsing and map back to the prepared actor", () => {
    const skills = ["Knowledge: Lore", "Piloting: Space", "Мой навык", "Pilot's Focus!"];
    const actor = { system: { skills: Object.fromEntries(skills.map(key => [key, {}])) } };
    for (const key of skills) {
        const slug = "skill:" + skillKey(key);
        assert.equal(slug.split(":").length, 2);
        assert.equal(findActorSkill(actor, slug.split(":")[1]), key);
    }
    assert.equal(findActorSkill(actor, "absent"), undefined);
});

test("a normal skill request carries the chosen difficulty and defaults to one net success", () => {
    const data = { what: "savingthrow", options: { ffgDifficulty: 0 }, requests: [{ type: "skill" }], dc: "" };
    configureRequest(data);
    assert.equal(difficultyValue(data.requests[0].ffgDifficulty), 0);
    assert.equal(data.dc, 1);
    data.dc = 3;
    configureRequest(data);
    assert.equal(data.dc, 3);
});

test("a contested request carries the same difficulty on both sides, even without a message argument", () => {
    const tokens = [0, 1].map(() => ({ requests: [{ type: "skill", key: "perception" }] }));
    configureRequest({ what: "contestedroll", options: { ffgDifficulty: 4 }, tokens });
    assert.ok(tokens.every(token => token.requests[0].ffgDifficulty === 4));
});

test("standard numeric dice keep their original DC", () => {
    const request = { type: "dice", key: "1d6" };
    const data = { what: "savingthrow", requests: [request], dc: "" };
    configureRequest(data);
    assert.deepEqual(data, { what: "savingthrow", requests: [{ type: "dice", key: "1d6" }], dc: "" });
});

test("narrative symbols follow per-token visibility and reveal", () => {
    for (const rollMode of ["roll", "gmroll", "blindroll", "selfroll"]) {
        for (const isGM of [false, true]) {
            for (const isOwner of [false, true]) {
                for (const revealed of [false, true]) {
                    for (const showToken of [false, true]) {
                        const actual = canShowResult({ rollMode, isGM, isOwner, revealed, showToken });
                        const expected = revealed && (isGM || (showToken && (rollMode === "roll" || rollMode === "gmroll" && isOwner)));
                        assert.equal(actual, expected);
                    }
                }
            }
        }
    }
});
