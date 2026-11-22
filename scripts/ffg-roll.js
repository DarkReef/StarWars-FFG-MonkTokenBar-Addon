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

export function buildSkillPool(actor, key, difficulty = 2, requested = {}) {
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
  const additions = {};
  for (const field of ["boost", "setback", "force", "upgradeAbility", "upgradeDifficulty"]) {
    additions[field] = Number(requested?.[field] ?? 0);
    if (!Number.isInteger(additions[field]) || additions[field] < 0 || additions[field] > 999) {
      throw new RangeError(game.i18n.localize("SWFFGMTB.InvalidModifiers"));
    }
  }
  for (const field of ["boost", "setback", "force"]) modifiers[field] += additions[field];
  const pool = new globalThis.DicePoolFFG({ ...modifiers, ability: Math.max(value, rank), difficulty: level });
  pool.upgrade(Math.min(value, rank) + modifiers.upgrades + additions.upgradeAbility);
  if (additions.upgradeDifficulty) pool.upgradeDifficulty(additions.upgradeDifficulty);
  return pool;
}

// The .1405 builder has the same pool controls but only publishes standalone
// rolls. Intercept the submit on this dialog instance before its chat handler.
function promptLegacyPool({ actor, pool, skillName }) {
  return new Promise((resolve, reject) => {
    class RequestPool extends game.ffg.RollBuilderFFG {
      activateListeners(html) {
        super.activateListeners(html);
        html.find(".pool-roll-options").closest("details").remove();
        html[0].addEventListener("click", event => {
          if (!event.target.closest(".btn")) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          this._updateObject();
          this.close();
        }, true);
      }
      _updateObject() { resolve(this.dicePool); }
      async close(options) { resolve(null); return super.close(options); }
    }
    const title = `${actor.name} · ${game.i18n.localize(skillName)}`;
    const app = new RequestPool({ actor, document: actor, token: actor.token }, pool, title, skillName);
    app.options.id = `ffg-request-pool-${foundry.utils.randomID()}`;
    app._render(true).catch(reject);
  });
}

export async function rollSkill(actor, key, difficulty = 2, requested = {}, { prompt = false } = {}) {
  let pool = buildSkillPool(actor, key, difficulty, requested);
  if (prompt) {
    const options = { actor, pool, skillName: actor.system.skills[key].label || key };
    const Builder = game.ffg.RollBuilderFFG;
    pool = Builder?.promptPool ? await Builder.promptPool(options) : await promptLegacyPool(options);
    if (!pool) return null;
  }

  // A zero-die FFG term keeps symbol cancellation active even for a flat-modifier-only roll.
  const formula = pool.renderDiceExpression() || "0da";
  return new game.ffg.RollFFG(formula, {}, pool).evaluate();
}

export function getNarrativeResult(roll) {
  if (!roll?.ffg) return null;
  return Object.fromEntries(symbols.map(key => [key, Number(roll.ffg[key]) || 0]));
}
