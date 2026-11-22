import assert from "node:assert/strict";
import { test } from "node:test";
import { addRecipients, assignedRecipients, includeBlindOwners, normalizeRequestTargets } from "../scripts/recipients.js";

const world = (id, name) => ({ id, uuid: "Actor." + id, name, documentName: "Actor", isOwner: true });
const a = world("a1", "Pilot");
const b = world("a2", "Pilot");
function token(id, actor) {
    const document = { id, name: actor.name, actor, uuid: "Scene.scene.Token." + id, documentName: "Token", getFlag: () => undefined };
    const placeable = { id, name: document.name, actor, document };
    document.object = placeable;
    return placeable;
}
const t1 = token("t1", a);
const t2 = token("t2", a);
const api = async uuid => [a, b, t1.document, t2.document].find(doc => doc.uuid === uuid);

test("the request API converts TokenDocuments and UUIDs without losing per-recipient options", async () => {
    const prior = globalThis.game;
    globalThis.game = { actors: { get: id => [a, b].find(actor => actor.id === id) }, i18n: { localize: key => key } };
    try {
    const result = await normalizeRequestTargets([t1.document, { token: b.uuid, fastForward: true }, t2.document.uuid], api);
    assert.deepEqual(result, [t1, { token: b.id, fastForward: true }, t2]);
    assert.deepEqual(await normalizeRequestTargets(a, api), [a.id]);
    assert.deepEqual(await normalizeRequestTargets("Pilot, t2", api), ["Pilot", "t2"]);
    await assert.rejects(normalizeRequestTargets("Actor.deleted", api));
    await assert.rejects(normalizeRequestTargets({ ...a, id: null }, api));
    } finally {
        if (prior === undefined) delete globalThis.game;
        else globalThis.game = prior;
    }
});

test("a directory actor with no token can precede a selected token; two distinct minion tokens survive", () => {
    const app = { entries: [{ token: b, id: b.id }] };
    const makeEntries = list => list.map(token => ({ token, id: token.id }));
    assert.equal(addRecipients(app, [t1, t2, t1], makeEntries), true);
    assert.deepEqual(app.entries.map(entry => entry.id), ["a2", "t1", "t2"]);
    assert.equal(addRecipients(app, [t2, b], makeEntries), false);
});

test("an empty scene can request assigned characters without picking every NPC or undoing token exclusions", () => {
    const c = world("a3", "Other");
    const hidden = token("hidden", c);
    hidden.document.getFlag = () => "exclude";
    assert.deepEqual(assignedRecipients([{ character: a }, { character: a }, { character: b }, { character: c }], [t1, hidden]), [b]);
});

test("blind requests reach directory-actor owners and keep the message private", t => {
    const prior = globalThis.game;
    t.after(() => { if (prior === undefined) delete globalThis.game; else globalThis.game = prior; });
    const actor = { testUserPermission: (user, level) => user.id === "owner" && level === "OWNER" };
    globalThis.game = { actors: { get: id => id === "a" ? actor : undefined },
        users: [{ id: "gm", isGM: true }, { id: "owner" }, { id: "other" }] };
    const flags = { what: "savingthrow", rollmode: "blindroll", tokena: { actorid: "a", uuid: "Actor.a" } };
    const message = { flags: { "monks-tokenbar": flags }, whisper: ["gm"],
        updateSource(update) { this.whisper = update.whisper; } };
    includeBlindOwners(message);
    assert.deepEqual(message.whisper, ["gm", "owner"]);
    flags.rollmode = "selfroll";
    message.whisper = ["gm"];
    includeBlindOwners(message);
    assert.deepEqual(message.whisper, ["gm"]);
});
