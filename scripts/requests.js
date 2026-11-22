export const DEFAULT_DIFFICULTY = 2;

// TokenBar compares keys in lower case and splits requests on every colon.
export function skillKey(name) {
    return encodeURIComponent(name.toLowerCase())
        .replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16))
        .toLowerCase();
}

export function findActorSkill(actor, key) {
    return Object.keys(actor.system?.skills ?? {}).find(name => skillKey(name) === key);
}

export function difficultyValue(value) {
    if (value == null || value === "") return DEFAULT_DIFFICULTY;
    const difficulty = Number(value);
    if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 5) {
        throw new RangeError(game.i18n.localize("SWFFGMTB.InvalidDifficulty"));
    }
    return difficulty;
}

// Both kinds of card serialize requests. Passing the difficulty on each skill
// request also works for contests, where TokenBar omits the message argument.
export function configureRequest(data) {
    const groups = data.requests ? [data.requests] : (data.tokens ?? []).map(token => token.requests ?? []);
    const requests = groups.flat();
    const skills = requests.filter(request => request.type === "skill");
    if (!skills.length) return;
    const difficulty = data.options?.ffgDifficulty ?? DEFAULT_DIFFICULTY;
    for (const request of skills) request.ffgDifficulty = difficulty;
    if (data.what === "savingthrow" && requests.length === skills.length && (data.dc == null || data.dc === "")) {
        data.dc = 1;
    }
}

export function addDifficultyControl(app, html) {
    const header = html.querySelector(".sheet-header");
    if (!header || header.querySelector("[data-ffg-difficulty]")) return;
    const container = document.createElement("div");
    container.className = "form-group";
    container.dataset.ffgDifficulty = "";
    const label = document.createElement("label");
    const select = document.createElement("select");
    select.id = app.id + "-ffg-difficulty";
    label.htmlFor = select.id;
    label.textContent = game.i18n.localize("SWFFGMTB.Difficulty");
    for (let count = 0; count <= 5; count++) {
        select.add(new Option(game.i18n.localize("SWFFGMTB.Difficulty" + count), String(count)));
    }
    select.value = String(app.opts.ffgDifficulty ?? DEFAULT_DIFFICULTY);
    select.addEventListener("change", () => { app.opts.ffgDifficulty = Number(select.value); });
    container.append(label, select);
    header.prepend(container);
}
