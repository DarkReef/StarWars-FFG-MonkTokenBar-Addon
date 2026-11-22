import { MonksTokenBar } from "../../monks-tokenbar/monks-tokenbar.js";
import { BaseRolls } from "../../monks-tokenbar/systems/base-rolls.js";
import { getNarrativeResult, getSkillOptions, rollSkill } from "./ffg-roll.js";
import { addDifficultyControl, configureRequest, difficultyValue, findActorSkill, skillKey } from "./requests.js";
import { renderResults } from "./results.js";

class StarWarsRolls extends BaseRolls {
    get _supportedSystem() { return true; }
    get canReroll() { return false; } // TokenBar would reroll the numeric summary.
    get showRoll() { return false; }
    get dcLabel() { return "SWFFGMTB.SuccessThreshold"; }
    isCritical() { return false; }

    get requestoptions() {
        const actors = [...(game.actors?.contents ?? []), ...(canvas.tokens?.placeables ?? []).map(token => token.actor)].filter(Boolean);
        const skills = Object.entries(getSkillOptions(actors));
        const groups = Object.fromEntries(skills.map(([key, label]) => [skillKey(key), label]));
        return [{ id: "skill", text: "SWFFGMTB.Skills", groups }, ...super.requestoptions];
    }

    get contestedoptions() { return this.requestoptions; }

    defaultRequest() {
        const skills = this.requestoptions[0].groups;
        const key = Object.hasOwn(skills, "perception") ? "perception" : Object.keys(skills)[0];
        return key ? { type: "skill", key } : { type: "dice", key: "1d6" };
    }

    defaultContested() { return this.defaultRequest(); }

    getValue(actor, type, key) {
        if (type !== "skill") return null;
        return actor.system.skills?.[findActorSkill(actor, key)]?.rank ?? null;
    }

    async roll({ id, actor, request }, callback) {
        try {
            const key = findActorSkill(actor, request.key);
            if (request.type !== "skill" || !key) {
                const available = this.requestoptions[0].groups;
                throw new Error(game.i18n.format("SWFFGMTB.SkillUnavailable", { actor: actor.name, skill: available[request.key] ?? request.key }));
            }
            const roll = await rollSkill(actor, key, difficultyValue(request.ffgDifficulty));
            const result = getNarrativeResult(roll);
            if (!result) throw new Error(game.i18n.localize("SWFFGMTB.NoResult"));
            // Native RollFFG.total is 0. A deterministic core Roll survives
            // TokenBar's websocket and Roll.fromData without rerolling any die.
            const total = result.success - result.failure;
            const summary = await new Roll(String(total), {}, { starwarsffgTokenbar: result }).evaluate({ allowInteractive: false });
            return await callback(summary);
        } catch (error) {
            ui.notifications.warn(error.message);
            return { id, error: true, msg: error.message };
        }
    }
}

// The dependency registers its built-in adapter on setup. Register after its
// hook, before ready constructs the bar and caches its buttons.
Hooks.once("setup", () => {
    if (game.system.id !== "starwarsffg") return;
    MonksTokenBar.system = new StarWarsRolls();
    Hooks.on("monks-tokenbar.requestRoll", configureRequest);
    Hooks.on("monks-tokenbar.requestContested", configureRequest);
    Hooks.on("renderSavingThrowApp", addDifficultyControl);
    Hooks.on("renderContestedRollApp", addDifficultyControl);
    Hooks.on("renderChatMessageHTML", renderResults);
});
