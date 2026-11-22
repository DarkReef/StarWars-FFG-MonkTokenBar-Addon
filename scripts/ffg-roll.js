const symbols = ["success", "failure", "advantage", "threat", "triumph", "despair", "light", "dark"];
const poolModifiers = ["boost", "setback", "remsetback", "force", "upgrades", ...symbols];

// CONFIG.FFG.skills is the world's active theme. Actors may have extra custom skills.
export function getSkillOptions(actors = []) {
  const options = new Map();
  for (const skills of [CONFIG.FFG.skills, ...Array.from(actors, actor => actor?.system?.skills)]) {
    for (const [key, skill] of Object.entries(skills ?? {})) {
      if (!skill) continue;
      options.set(key, game.i18n.localize(skill.label || key));
    }
  }
  return Object.fromEntries([...options].sort((a, b) => a[1].localeCompare(b[1], game.i18n.lang)));
}

export async function rollSkill(actor, key, difficulty = 2) {
  const level = Number(difficulty);
  if (difficulty == null || String(difficulty).trim() === "" || !Number.isInteger(level) || level < 0 || level > 5) {
    throw new Error(game.i18n.localize("SWFFGMTB.InvalidDifficulty"));
  }

  const skills = actor?.system?.skills ?? {};
  const skill = Object.hasOwn(skills, key) ? skills[key] : undefined;
  const characteristic = actor?.system?.characteristics?.[skill?.characteristic];
  if (characteristic?.value == null || !Number.isFinite(Number(characteristic.value))) {
    throw new Error(game.i18n.format("SWFFGMTB.SkillUnavailable", { actor: actor?.name ?? "", skill: key }));
  }

  // Prepared skill ranks already include actor modifiers and surviving group minions.
  const value = Number(characteristic.value);
  const rank = Number(skill.rank ?? 0);
  const modifiers = Object.fromEntries(poolModifiers.map(field => [field, Number(skill[field]) || 0]));
  const pool = new globalThis.DicePoolFFG({ ...modifiers, ability: Math.max(value, rank), difficulty: level });
  pool.upgrade(Math.min(value, rank) + pool.upgrades);

  // A zero-die FFG term keeps symbol cancellation active even for a flat-modifier-only roll.
  const formula = pool.renderDiceExpression() || "0da";
  return new game.ffg.RollFFG(formula, {}, pool).evaluate();
}

export function getNarrativeResult(roll) {
  if (!roll?.ffg) return null;
  return Object.fromEntries(symbols.map(key => [key, Number(roll.ffg[key]) || 0]));
}
