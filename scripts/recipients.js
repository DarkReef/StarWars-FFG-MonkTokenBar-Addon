// SavingThrowApp 14.01 accepts canvas placeables or world actor IDs. A TokenDocument
// and a full UUID both fall through its normal lookup and can select the default party.
export async function normalizeRequestTargets(targets, resolveUuid) {
    if (targets == null) return targets;
    const list = typeof targets === "string" ? targets.split(",").map(value => value.trim()) :
        Array.isArray(targets) ? targets : [targets];
    return Promise.all(list.map(async entry => {
        const wrapped = entry?.constructor === Object && Object.hasOwn(entry, "token");
        let target = wrapped ? entry.token : entry;
        if (typeof target === "string" && /^(Actor\.|Scene\.[^.]+\.Token\.)/.test(target)) {
            target = await resolveUuid(target);
            if (!target) throw new Error(game.i18n.localize("SWFFGMTB.MissingRecipient"));
        }
        if (target?.documentName === "Token") {
            // An off-scene unlinked token has a distinct synthetic actor and may
            // have different skills. Never substitute its base actor silently.
            if (!target.object?.actor) throw new Error(game.i18n.localize("SWFFGMTB.TokenOffCanvas"));
            target = target.object;
        } else if (target?.documentName === "Actor") {
            if (target.isToken && target.token?.object) target = target.token.object;
            else if (target.id && !target.isToken && game.actors.get(target.id)) target = target.id;
            else throw new Error(game.i18n.localize("SWFFGMTB.MissingRecipient"));
        }
        return wrapped ? { ...entry, token: target } : target;
    }));
}

export function assignedRecipients(users, placeables) {
    const onScene = new Set(placeables.map(token => token.actor?.id));
    return [...new Set(Array.from(users, user => user.character).filter(actor => actor?.isOwner && !onScene.has(actor.id)))];
}

function targetUuid(target) {
    return target?.document?.uuid ?? target?.uuid;
}

export function addRecipients(app, targets, getEntries) {
    const seen = new Set(app.entries.map(entry => targetUuid(entry.token)));
    const added = [];
    for (const entry of getEntries(targets)) {
        const uuid = targetUuid(entry.token);
        if (!uuid || seen.has(uuid)) continue;
        added.push(entry);
        seen.add(uuid);
    }
    app.entries.push(...added);
    return added.length > 0;
}

const initialized = new WeakSet();

export function renderRecipients(app, html, getEntries) {
    const group = html.querySelector(".player-group");
    if (!group || group.querySelector("[data-ffg-recipients]")) return;
    if (!initialized.has(app)) {
        initialized.add(app);
        // Native addToken dereferences e.token.actor.id even for an Actor.
        // Keep the original entry format used by the chat card and roll handler.
        app.addToken = function (targets) {
            const list = Array.isArray(targets) ? targets : [targets];
            const valid = list.filter(target => target?.actor || target?.documentName === "Actor");
            if (addRecipients(this, valid.map(target => target.documentName === "Actor" ? target.id : target), getEntries)) {
                this.render({ force: true });
            }
        };
        if (!app.entries.length) {
            const assigned = assignedRecipients(game.users, canvas.tokens?.placeables ?? []);
            if (addRecipients(app, assigned.map(actor => actor.id), getEntries)) app.render({ force: true });
        }
    }

    const wrap = document.createElement("div");
    wrap.dataset.ffgRecipients = "";
    wrap.className = "form-group";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = game.i18n.localize("SWFFGMTB.FindActor");
    input.setAttribute("aria-label", input.placeholder);
    const select = document.createElement("select");
    select.setAttribute("aria-label", input.placeholder);
    const actors = game.actors.contents.filter(actor => actor.isOwner).sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    function filter() {
        const query = input.value.trim().toLocaleLowerCase();
        const options = [new Option(game.i18n.localize("SWFFGMTB.AddActor"), "")];
        for (const actor of actors) {
            if (!actor.name.toLocaleLowerCase().includes(query)) continue;
            const label = actor.folder?.name ? `${actor.name} · ${actor.folder.name}` : actor.name;
            options.push(new Option(label, actor.id));
        }
        select.replaceChildren(...options);
    }
    function choose(id) {
        const actor = game.actors.get(id);
        if (!actor?.isOwner) return;
        // Prefer the selected representation; retain the synthetic token if the
        // actor has exactly one token on this canvas. Otherwise target the Actor.
        const placed = (canvas.tokens?.placeables ?? []).filter(token => token.actor?.id === actor.id && token.isVisible !== false);
        const selected = placed.find(token => token.controlled);
        app.addToken(selected ?? (placed.length === 1 ? placed[0] : actor));
    }
    input.addEventListener("input", filter);
    input.addEventListener("keydown", event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (select.options.length === 2) choose(select.options[1].value);
    });
    select.addEventListener("change", () => choose(select.value));
    group.addEventListener("dragover", event => {
        if (event.dataTransfer?.types.includes("text/plain")) event.preventDefault();
    });
    group.addEventListener("drop", event => {
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (data.type !== "Actor" || !/^Actor\.[^.]+$/.test(data.uuid)) return;
        event.preventDefault();
        choose(data.uuid.slice("Actor.".length));
    });
    filter();
    wrap.append(input, select);
    group.querySelector("header")?.after(wrap);
}

export function includeBlindOwners(message) {
    const request = message.flags?.["monks-tokenbar"];
    if (request?.what !== "savingthrow" || request.rollmode !== "blindroll") return;
    const recipients = new Set(message.whisper);
    for (const [key, target] of Object.entries(request)) {
        if (!key.startsWith("token") || !target?.uuid?.startsWith("Actor.")) continue;
        const actor = game.actors.get(target.actorid);
        if (!actor) continue;
        for (const user of game.users) {
            if (!user.isGM && actor.testUserPermission(user, "OWNER")) recipients.add(user.id);
        }
    }
    if (recipients.size !== message.whisper.length) message.updateSource({ whisper: [...recipients] });
}
