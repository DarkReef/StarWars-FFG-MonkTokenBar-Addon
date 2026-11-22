import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

test("the installed setup hook connects both card types to one narrative roll and preserves its results", async () => {
    const previous = new Map(["Hooks", "CONFIG", "game", "canvas", "Roll", "DicePoolFFG", "ui"].map(key => [key, globalThis[key]]));
    const callbacks = new Map();
    const tokenbarUrl = "data:text/javascript,export const MonksTokenBar = {};";
    const baseUrl = "data:text/javascript,export class BaseRolls {get requestoptions(){return []}}";
    const registered = registerHooks({
        resolve(specifier, context, nextResolve) {
            if (specifier === "../../monks-tokenbar/monks-tokenbar.js") return { url: tokenbarUrl, shortCircuit: true };
            if (specifier === "../../monks-tokenbar/systems/base-rolls.js") return { url: baseUrl, shortCircuit: true };
            return nextResolve(specifier, context);
        }
    });
    try {
        let rolls = 0;
        const actor = { name: "Rebel", system: { characteristics: { agility: { value: 3 } }, skills: {
            "Piloting: Space": { label: "Piloting", rank: 2, characteristic: "agility" }
        } } };
        const ffg = { success: 0, failure: 1, advantage: 2, threat: 0, triumph: 1, despair: 1, light: 0, dark: 0 };
        globalThis.Hooks = { once: (name, fn) => callbacks.set(name, fn), on: (name, fn) => callbacks.set(name, fn) };
        globalThis.canvas = { tokens: { placeables: [] } };
        globalThis.CONFIG = { FFG: { skills: actor.system.skills } };
        globalThis.game = { system: { id: "starwarsffg" }, actors: { contents: [actor] }, i18n: { lang: "en", localize: key => key } };
        globalThis.game.ffg = { RollFFG: class {
            constructor(_formula, _data, options) { this.options = options; }
            async evaluate() { rolls++; this.total = 0; this.ffg = ffg; return this; }
        } };
        globalThis.DicePoolFFG = class { upgrade() {} renderDiceExpression() { return "2dp+1da+2di"; } };
        globalThis.Roll = class {
            constructor(formula, data, options) { this.total = Number(formula); this.options = options; }
            async evaluate() { return this; }
        };
        globalThis.ui = { notifications: { warn: assert.fail } };
        await import("../scripts/main.js");
        const { MonksTokenBar } = await import(tokenbarUrl);
        callbacks.get("setup")();
        const adapter = MonksTokenBar.system;
        assert.equal(adapter._supportedSystem, true);
        assert.equal(adapter.canReroll, false);
        assert.equal(callbacks.get("monks-tokenbar.requestContested"), callbacks.get("monks-tokenbar.requestRoll"));
        assert.equal(adapter.contestedoptions[0].groups["piloting%3a%20space"], "Piloting");
        const request = { type: "skill", key: "piloting%3a%20space", ffgDifficulty: 2 };
        const response = await adapter.roll({ id: "tokenA", actor, request, fastForward: true }, async roll => ({ id: "tokenA", roll }));
        assert.equal(rolls, 1);
        assert.equal(response.roll.total, -1);
        assert.deepEqual(JSON.parse(JSON.stringify(response.roll)).options.starwarsffgTokenbar, ffg);
        assert.deepEqual(JSON.parse(JSON.stringify(response.roll)).options.starwarsffgCheck.pool, {
            ability: 1, proficiency: 2, difficulty: 2, challenge: 0, boost: 0, setback: 0, force: 0
        });
    } finally {
        registered.deregister();
        for (const [key, value] of previous) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
});
