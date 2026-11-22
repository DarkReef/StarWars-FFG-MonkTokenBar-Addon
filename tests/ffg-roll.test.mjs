import assert from "node:assert/strict";
import { test } from "node:test";
import { getNarrativeResult, getSkillOptions, rollSkill } from "../scripts/ffg-roll.js";

const labels = { perception: "Восприятие", lore: "Знания", custom: "Искусство" };
globalThis.CONFIG = { FFG: { skills: { Perception: { label: "perception" }, "Knowledge: Lore": { label: "lore" } } } };
globalThis.game = {
  i18n: {
    lang: "ru", localize: key => labels[key] ?? key,
    format: (key, { actor, skill }) => `${key} ${actor} ${skill}`
  },
  ffg: { RollFFG: class {
    constructor(formula, data, pool) { Object.assign(this, { formula, data, pool }); }
    async evaluate() { this.evaluated = true; return this; }
  } }
};

globalThis.DicePoolFFG = class {
  constructor(values) { Object.assign(this, values); }
  upgrade(times) { this.appliedUpgrades = times; }
  renderDiceExpression() { return this.ability > 0 ? "test-pool" : ""; }
};

test("request choices include the active theme and actor-specific skills, preserving keys", () => {
  const actor = { system: { skills: { "Custom: Art": { label: "custom" } } } };
  assert.deepEqual(getSkillOptions([actor]), {
    Perception: "Восприятие", "Knowledge: Lore": "Знания", "Custom: Art": "Искусство"
  });
});

test("rolls from prepared token actor data and passes the whole modifier set to RollFFG", async () => {
  const skill = {
    characteristic: "cunning", rank: 4, boost: 2, setback: 3, remsetback: 1, force: 1, upgrades: 1,
    success: 2, failure: 1, advantage: -1, threat: 2, triumph: 1, despair: 1, light: 1, dark: 1
  };
  const actor = { system: { skills: { Perception: skill }, characteristics: { cunning: { value: 3 } } } };
  const roll = await rollSkill(actor, "Perception", "0");
  assert.equal(roll.evaluated, true);
  assert.equal(roll.pool.ability, 4);
  assert.equal(roll.pool.appliedUpgrades, 4);
  assert.equal(roll.pool.difficulty, 0);
  for (const field of Object.keys(skill).filter(field => !["characteristic", "rank"].includes(field))) {
    assert.equal(roll.pool[field], skill[field], field);
  }
});

test("empty pools still evaluate as a narrative roll", async () => {
  const actor = { system: {
    skills: { Perception: { characteristic: "cunning", success: 1, failure: 1 } },
    characteristics: { cunning: { value: 0 } }
  } };
  assert.equal((await rollSkill(actor, "Perception", 0)).formula, "0da");
});

test("missing skill, missing characteristic and out-of-range difficulty fail before a roll", async () => {
  const actor = { name: "A", system: { skills: { Test: { characteristic: "cunning" } } } };
  await assert.rejects(rollSkill(actor, "Other"), /SkillUnavailable A Other/);
  await assert.rejects(rollSkill(actor, "Test"), /SkillUnavailable A Test/);
  for (const level of [-1, 6, "x", "", null, 2.5]) {
    await assert.rejects(rollSkill(actor, "Test", level), /InvalidDifficulty/);
  }
});

test("returns the eight narrative axes, including Force points, separately from numerical total", () => {
  const ffg = { success: 1, failure: 0, advantage: 0, threat: 2, triumph: 1, despair: 1, light: 2, dark: 1 };
  assert.deepEqual(getNarrativeResult({ total: 0, ffg }), ffg);
  assert.equal(getNarrativeResult({ total: 12 }), null);
});
