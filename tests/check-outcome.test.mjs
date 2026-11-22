import assert from "node:assert/strict";
import { test } from "node:test";
import * as dice from "../scripts/ffg-roll.js";

const allSymbols = { success: 0, failure: 0, advantage: 0, threat: 0, triumph: 0, despair: 0, light: 0, dark: 0 };
const entryWith = (symbols, check) => ({
  roll: { total: 99, options: { starwarsffgTokenbar: symbols, ...(check && { starwarsffgCheck: check }) } }
});

test("outcomes cancel opposite axes only; triumph and despair have already contributed to net successes", () => {
  const row = entryWith({ ...allSymbols, success: 3, failure: 2, advantage: 1, threat: 3, triumph: 2, despair: 1, light: 1, dark: 2 });
  const outcome = dice.readCheckOutcome(row, "3");
  assert.deepEqual(outcome.symbols, { ...allSymbols, success: 1, threat: 2, triumph: 2, despair: 1, light: 1, dark: 2 });
  assert.equal(outcome.netSuccess, 1);
  assert.equal(outcome.netAdvantage, -2);
  assert.equal(outcome.succeeded, true);
  assert.equal(outcome.threshold, 3);
  assert.equal(outcome.meetsThreshold, false);
  assert.equal(outcome.pool, null, "legacy numerical summaries do not identify the dice");
  assert.equal(outcome.modifiers, null);
  assert.equal(dice.readCheckOutcome(entryWith({ ...allSymbols, advantage: 2, triumph: 1, despair: 1 }), "").succeeded, false);
});

test("missing, errored, generic and malformed rolls never turn into a zero-success FFG outcome", () => {
  for (const row of [undefined, {}, { roll: { total: 1 } }, entryWith({}), entryWith({ success: "unknown" }),
    { ...entryWith(allSymbols), error: true }]) assert.equal(dice.readCheckOutcome(row, 1), null);
  const blank = dice.readCheckOutcome(entryWith(allSymbols));
  assert.equal(blank.netSuccess, 0);
  assert.equal(blank.meetsThreshold, null, "a contest has no independent custom target");
  assert.equal(dice.readCheckOutcome(entryWith(allSymbols), "0").meetsThreshold, true);
});

test("the persisted pool describes evaluated dice after adjustments and retains signed automatic modifiers", async () => {
  const previous = { game: globalThis.game, DicePoolFFG: globalThis.DicePoolFFG };
  try {
    globalThis.DicePoolFFG = class {
      constructor(values) { Object.assign(this, values); }
      upgrade() {}
      renderDiceExpression() {
        return `1da+2dp+${this.difficulty}di+${this.challenge}dc+${this.boost}db+${this.setback-this.remsetback}ds+1df`;
      }
    };
    let evaluations = 0;
    globalThis.game = { i18n: { localize: key => key }, ffg: {
      RollBuilderFFG: { promptPool: async ({ pool }) => Object.assign(pool, { difficulty: 1, challenge: 2, boost: 4, threat: -1, triumph: 2 }) },
      RollFFG: class {
        constructor(formula, _data, options) { this.formula = formula; this.options = options; }
        async evaluate() { evaluations++; this.ffg = { ...allSymbols, success: 2, triumph: 2 }; return this; }
      }
    } };
    const actor = { system: { characteristics: { Cunning: { value: 3 } }, skills: {
      Perception: { rank: 2, characteristic: "Cunning", setback: 4, remsetback: 3, force: 1 }
    } } };
    const roll = await dice.rollSkill(actor, "Perception", 4, {}, { prompt: true });
    const options = JSON.parse(JSON.stringify(roll.options.starwarsffgCheck));
    const outcome = dice.readCheckOutcome(entryWith(roll.ffg, options), 1);
    assert.deepEqual(outcome.pool, { ability: 1, proficiency: 2, difficulty: 1, challenge: 2, boost: 4, setback: 1, force: 1 });
    assert.deepEqual(outcome.modifiers, { ...allSymbols, threat: -1, triumph: 2 });
    assert.equal(outcome.requestedDifficulty, 4);
    assert.equal(outcome.skillKey, "Perception");
    assert.equal(evaluations, 1);
    assert.equal(outcome.netSuccess, 2);
  } finally {
    Object.assign(globalThis, previous);
  }
});
