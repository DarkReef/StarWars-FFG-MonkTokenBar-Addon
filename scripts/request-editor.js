import { buildSkillPool } from "./ffg-roll.js";
import { DEFAULT_DIFFICULTY, findActorSkill } from "./requests.js";

const dice = {
    a: ["green.png", "AbilityDie"], p: ["yellow.png", "ProficiencyDie"],
    b: ["blue.png", "BoostDie"], s: ["black.png", "SetbackDie"],
    i: ["purple.png", "DifficultyDie"], c: ["red.png", "ChallengeDie"], f: ["white.gif", "ForceDie"]
};
const adjustments = {
    boost: ["b", "BoostDie"], setback: ["s", "SetbackDie"], force: ["f", "ForceDie"],
    upgradeAbility: ["p", "UpgradeAbility"], upgradeDifficulty: ["c", "UpgradeDifficulty"]
};
const listeners = new WeakMap();
const label = key => game.i18n.localize("SWFFGMTB." + key);
const ensureArray = value => value == null ? [] : Array.isArray(value) ? value : [value];

function element(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
}

function die(code) {
    const [filename, title] = dice[code];
    const img = element("img");
    img.src = foundry.utils.getRoute("systems/starwarsffg/images/dice/starwars/" + filename);
    img.alt = label(title);
    img.title = img.alt;
    return img;
}

function labeledControl(name, control) {
    const container = element("label", "swffg-pool-field");
    container.append(element("span", "", label(name)), control);
    return container;
}

function makeAdjustment(key, app, redraw) {
    const [code, title] = adjustments[key];
    const control = element("input");
    control.type = "number";
    control.min = "0";
    control.max = "999";
    control.step = "1";
    control.value = String(app.opts.ffgModifiers?.[key] ?? 0);
    control.dataset.ffgModifier = key;
    control.setAttribute("aria-label", label(title));
    const set = next => {
        if (!Number.isSafeInteger(next) || next < 0 || next > 999) return;
        app.opts.ffgModifiers = { ...app.opts.ffgModifiers, [key]: next };
        control.value = String(next);
        redraw();
    };
    control.addEventListener("input", () => {
        if (control.value !== "" && control.validity.valid) set(control.valueAsNumber);
    });
    control.addEventListener("change", () => {
        if (control.value === "") set(0);
        else if (!control.validity.valid) control.value = String(app.opts.ffgModifiers?.[key] ?? 0);
    });
    const group = element("div", "swffg-pool-adjustment");
    const heading = element("label");
    control.id = app.id + "-ffg-" + key;
    heading.htmlFor = control.id;
    heading.append(die(code), document.createTextNode(label(title)));
    const changeBy = (delta, glyph, prefix) => {
        const button = element("button", "", glyph);
        button.type = "button";
        button.setAttribute("aria-label", label(prefix) + " · " + label(title));
        button.addEventListener("click", () => set(Number(app.opts.ffgModifiers?.[key] ?? 0) + delta));
        return button;
    };
    const stepper = element("div", "swffg-pool-stepper");
    stepper.append(changeBy(-1, "−", "RemoveOne"), control, changeBy(1, "+", "AddOne"));
    group.append(heading, stepper);
    return group;
}

function skillName(app, request) {
    return app.requestoptions.find(group => group.id === "skill")?.groups?.[request.key] ?? request.key;
}

function preview(app, contested, output) {
    output.replaceChildren();
    const entries = app.entries.map(entry => ({
        actor: entry.token?.actor ?? entry.token,
        name: entry.token?.name,
        requests: ensureArray(contested ? entry.request : app.request).filter(r => r?.type === "skill")
    }));
    for (const entry of entries) {
        if (!entry.actor) continue;
        for (const request of entry.requests) {
            const row = element("div", "swffg-pool-row");
            row.append(element("span", "swffg-pool-who", entry.name + " · " + skillName(app, request)));
            const skill = findActorSkill(entry.actor, request.key);
            let formula;
            try {
                if (skill) formula = buildSkillPool(entry.actor, skill, app.opts.ffgDifficulty ?? DEFAULT_DIFFICULTY,
                    app.opts.ffgModifiers ?? {}).renderDiceExpression();
            } catch (error) {
                row.append(element("span", "", error.message));
            }
            if (!skill) row.append(element("span", "", label("SkillMissing")));
            else if (formula === "") row.append(element("span", "", label("EmptyDice")));
            else if (formula) {
                const terms = element("span", "swffg-pool-terms");
                for (const [, number, code] of formula.matchAll(/(\d+)d([apbsicf])/g)) {
                    const item = element("span", "swffg-pool-term");
                    item.append(die(code), document.createTextNode("×" + number));
                    terms.append(item);
                }
                row.append(terms);
            }
            output.append(row);
        }
    }
    output.hidden = !output.childElementCount;
}

export function renderRequestEditor(app, html) {
    const header = html.querySelector(".sheet-header");
    if (!header) return;
    listeners.get(app)?.abort();
    const controller = new AbortController();
    listeners.set(app, controller);
    html.querySelector("[data-ffg-request-editor]")?.remove();
    const panel = element("section", "swffg-request-editor");
    panel.dataset.ffgRequestEditor = "";
    const contested = Boolean(html.querySelector("select.request-roll[data-index]"));
    const controls = element("div", "swffg-pool-controls");
    const difficulty = element("select");
    difficulty.dataset.ffgDifficulty = "";
    for (let number = 0; number <= 5; number++) {
        difficulty.add(new Option(label("Difficulty" + number), String(number)));
    }
    difficulty.value = String(app.opts.ffgDifficulty ?? DEFAULT_DIFFICULTY);
    const difficultyField = labeledControl("Difficulty", difficulty);
    const output = element("div", "swffg-pool-preview");
    output.setAttribute("aria-live", "polite");
    let skillSelect;
    if (!contested) {
        skillSelect = element("select");
        skillSelect.dataset.ffgSkill = "";
        skillSelect.add(new Option(label("SelectSkill"), ""));
        for (const [key, title] of Object.entries(app.requestoptions.find(group => group.id === "skill")?.groups ?? {})) {
            skillSelect.add(new Option(title, key));
        }
        controls.append(labeledControl("SelectedSkill", skillSelect));
        skillSelect.addEventListener("change", () => {
            if (!skillSelect.value) return;
            const option = [...html.querySelectorAll('.request-option[data-type="skill"]')]
                .find(node => node.dataset.key === skillSelect.value);
            option?.click();
        });
    } else {
        // TokenBar 14.01 treats its per-side request array as an object in
        // renderContestedRollApp. Restore the value from the actual request.
        for (const select of html.querySelectorAll("select.request-roll[data-index]")) {
            const [request] = ensureArray(app.entries[Number(select.dataset.index)]?.request);
            if (request) select.value = request.type + ":" + request.key;
        }
        panel.append(element("p", "swffg-contest-hint", label("ContestPoolHint")));
    }
    controls.append(difficultyField);
    panel.append(controls);
    const modifiers = element("details", "swffg-pool-modifiers");
    modifiers.open = Boolean(app.swffgModifiersOpen ?? Object.values(app.opts.ffgModifiers ?? {}).some(Number));
    modifiers.addEventListener("toggle", () => { app.swffgModifiersOpen = modifiers.open; });
    modifiers.append(element("summary", "", label("PoolModifiers")));
    const adjustmentsGrid = element("div", "swffg-pool-adjustments");
    for (const key of Object.keys(adjustments)) adjustmentsGrid.append(makeAdjustment(key, app, refresh));
    modifiers.append(adjustmentsGrid);
    panel.append(modifiers, output);
    header.prepend(panel);

    function refresh() {
        const requested = contested ? app.entries.flatMap(e => ensureArray(e.request)) : ensureArray(app.request);
        const skills = requested.filter(r => r?.type === "skill");
        if (skillSelect) skillSelect.value = requested.length === 1 && skills.length === 1 ? skills[0].key : "";
        difficulty.disabled = !skills.length;
        modifiers.hidden = !skills.length;
        preview(app, contested, output);
    }
    difficulty.addEventListener("change", () => {
        app.opts.ffgDifficulty = Number(difficulty.value);
        refresh();
    });
    // Upstream updates request/entries in its own delegated action handlers.
    const changed = event => {
        if (event.target.closest(".request-option, select.request-roll[data-index]")) queueMicrotask(refresh);
    };
    html.addEventListener("click", changed, { signal: controller.signal });
    html.addEventListener("change", changed, { signal: controller.signal });
    refresh();
}
