const symbols = ["success", "failure", "advantage", "threat", "triumph", "despair", "light", "dark"];
const poolModifiers = ["boost", "setback", "remsetback", "force", "upgrades", ...symbols];
const dieTypes = { a: "ability", p: "proficiency", i: "difficulty", c: "challenge", b: "boost", s: "setback", f: "force" };

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
  // The expression is the actual roll, including the world's remove-setback
  // rule. The editable pool may still contain the unreduced number of dice.
  const dice = Object.fromEntries(Object.values(dieTypes).map(type => [type, 0]));
  const terms = formula.split("+").map(term => /^(\d+)d([apicbsf])$/i.exec(term.trim()));
  const knownPool = terms.every(Boolean);
  if (knownPool) {
    for (const [, count, die] of terms) dice[dieTypes[die.toLowerCase()]] += Number(count);
  }
  const check = {
    version: 1, skillKey: key, requestedDifficulty: Number(difficulty),
    pool: knownPool ? dice : null,
    modifiers: Object.fromEntries(symbols.map(symbol => [symbol, Number(pool[symbol] ?? 0)]))
  };
  return new game.ffg.RollFFG(formula, {}, { ...pool, starwarsffgCheck: check }).evaluate();
}

export function getNarrativeResult(roll) {
  const source = roll?.ffg;
  if (!source || typeof source !== "object" || !symbols.some(key => Object.hasOwn(source, key))) return null;
  const counts = {};
  for (const key of symbols) {
    const value = Object.hasOwn(source, key) ? numberValue(source[key]) : 0;
    if (!Number.isSafeInteger(value)) return null;
    counts[key] = value;
  }
  // RollFFG already includes the success carried by a triumph and the failure
  // carried by a despair. Those special symbols remain independent.
  const success = counts.success - counts.failure;
  const advantage = counts.advantage - counts.threat;
  counts.success = Math.max(0, success);
  counts.failure = Math.max(0, -success);
  counts.advantage = Math.max(0, advantage);
  counts.threat = Math.max(0, -advantage);
  return counts;
}

function numberValue(value) {
  if (typeof value === "number") return value;
  return typeof value === "string" && value.trim() ? Number(value) : NaN;
}

export function readCheckOutcome(entry, dc) {
  if (!entry || entry.error === true) return null;
  const options = entry.roll?.options;
  const counts = getNarrativeResult({ ffg: options?.starwarsffgTokenbar });
  if (!counts) return null;
  const netSuccess = counts.success - counts.failure;
  const target = numberValue(dc);
  const threshold = Number.isFinite(target) ? target : null;
  const check = options.starwarsffgCheck?.version === 1 ? options.starwarsffgCheck : null;
  const difficulty = numberValue(check?.requestedDifficulty);
  return {
    symbols: counts, netSuccess, netAdvantage: counts.advantage - counts.threat,
    succeeded: netSuccess > 0, threshold, meetsThreshold: threshold === null ? null : netSuccess >= threshold,
    skillKey: typeof check?.skillKey === "string" ? check.skillKey : null,
    requestedDifficulty: Number.isInteger(difficulty) && difficulty >= 0 && difficulty <= 5 ? difficulty : null,
    pool: check?.pool && Object.values(dieTypes).every(type => Number.isSafeInteger(check.pool[type]) && check.pool[type] >= 0) ? check.pool : null,
    modifiers: check?.modifiers && symbols.every(key => Number.isSafeInteger(check.modifiers[key])) ? check.modifiers : null
  };
}
