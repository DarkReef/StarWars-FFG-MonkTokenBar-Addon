import { MonksTokenBar } from "../../monks-tokenbar/monks-tokenbar.js";
import { BaseRolls } from "../../monks-tokenbar/systems/base-rolls.js";
import { getNarrativeResult, getSkillOptions, rollSkill } from "./ffg-roll.js";
import { configureRequest, difficultyValue, findActorSkill, skillKey } from "./requests.js";
import { renderRequestEditor } from "./request-editor.js";
import { renderResults } from "./results.js";
import { includeBlindOwners, normalizeRequestTargets, renderRecipients } from "./recipients.js";

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

    async roll({ id, actor, request, message, fastForward }, callback, event) {
        if (!game.user?.isGM && actor.isOwner === false) return { id };
        const target = event?.target;
        const messageId = message?.id ?? target?.closest?.("[data-message-id]")?.dataset?.messageId;
        const slot = messageId ? `${messageId}.${id}` : undefined;
        this.pendingRolls ??= new Set();
        if (slot && this.pendingRolls.has(slot)) return { id };
        if (slot) this.pendingRolls.add(slot);
        try {
            const key = findActorSkill(actor, request.key);
            if (request.type !== "skill" || !key) {
                const available = this.requestoptions[0].groups;
                throw new Error(game.i18n.format("SWFFGMTB.SkillUnavailable", { actor: actor.name, skill: available[request.key] ?? request.key }));
            }
            const prompt = !!target?.nodeType || fastForward !== true;
            const roll = await rollSkill(actor, key, difficultyValue(request.ffgDifficulty), request.ffgModifiers, { prompt });
            // Both TokenBar result collectors expect an object per recipient.
            // Without a roll or error they leave the row available for retry.
            if (!roll) return { id };
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
        } finally {
            if (slot) this.pendingRolls.delete(slot);
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
    Hooks.on("renderSavingThrowApp", renderRequestEditor);
    Hooks.on("renderSavingThrowApp", (app, html) => renderRecipients(app, html, tokens => MonksTokenBar.getTokenEntries(tokens)));
    Hooks.on("preCreateChatMessage", includeBlindOwners);
    Hooks.once("ready", () => {
        const api = game.MonksTokenBar;
        const original = api.requestRoll;
        api.requestRoll = async function (targets, options) {
            const entries = await normalizeRequestTargets(targets, uuid => fromUuid(uuid));
            return original.call(this, entries, options);
        };
    });
    Hooks.on("renderContestedRollApp", renderRequestEditor);
    Hooks.on("renderChatMessageHTML", renderResults);
});
