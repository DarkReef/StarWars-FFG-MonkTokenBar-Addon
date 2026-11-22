import assert from "node:assert/strict";
import { test } from "node:test";
import * as dice from "../scripts/ffg-roll.js";

test("requested dice combine with prepared skills, then the confirmed pool is rolled once", async () => {
  const before = { game: globalThis.game, DicePoolFFG: globalThis.DicePoolFFG };
  const actor = { system: { characteristics: { Cunning: { value: 3 } }, skills: {
    Perception: { characteristic: "Cunning", rank: 2, boost: 1, setback: 2, force: 1 }
  } } };
  let rolls = 0;
  let promptCount = 0;
  try {
    globalThis.DicePoolFFG = class {
      constructor(values) { Object.assign(this, values); }
      upgrade(count) { this.abilityUpgrade = count; }
      upgradeDifficulty(count) { this.difficultyUpgrade = count; }
      renderDiceExpression() { return "1da"; }
    };
    globalThis.game = { i18n: {localize: key => key}, ffg: {
      RollBuilderFFG: { promptPool: async ({ pool }) => { promptCount++; pool.boost++; return pool; } },
      RollFFG: class {
        constructor(_formula, _data, pool) { this.pool = pool; }
        async evaluate() { rolls++; return this; }
      }
    } };
    const requested = { boost: 2, setback: 3, force: 1, upgradeAbility: 1, upgradeDifficulty: 2 };
    const preview = dice.buildSkillPool(actor, "Perception", 0, requested);
    assert.deepEqual([preview.boost, preview.setback, preview.force, preview.abilityUpgrade, preview.difficultyUpgrade], [3, 5, 2, 3, 2]);
    const result = await dice.rollSkill(actor, "Perception", 0, requested, { prompt: true });
    assert.equal(result.pool.boost, 4);
    assert.equal(rolls, 1);
    assert.equal(promptCount, 1);
    game.ffg.RollBuilderFFG.promptPool = async () => null;
    assert.equal(await dice.rollSkill(actor, "Perception", 0, requested, { prompt: true }), null);
    assert.equal(rolls, 1, "Cancel must not evaluate any dice");
    assert.equal(actor.system.skills.Perception.boost, 1);
  } finally {
    Object.assign(globalThis, before);
  }
});
