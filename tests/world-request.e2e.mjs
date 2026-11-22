// From a GM browser with the source checkout installed, leave the chat log available:
// const { verifyWorldRequest } = await import("/modules/starwars-ffg-monktokenbar-addon/tests/world-request.e2e.mjs");
// await verifyWorldRequest("selfroll");
// await verifyWorldRequest("blindroll");
// await verifyWorldRequest("selfroll", { contested: true });

const moduleId = "starwars-ffg-monktokenbar-addon";
const narrativeSymbols = ["advantage", "dark", "despair", "failure", "light", "success", "threat", "triumph"];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(read, failure) {
  const deadline = performance.now() + 10000;
  do {
    const value = read();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (performance.now() < deadline);
  throw new Error(failure);
}

export async function verifyWorldRequest(rollMode = "selfroll", { contested = false } = {}) {
  check(["blindroll", "selfroll"].includes(rollMode), "Choose blindroll or selfroll for this private test.");
  check(game.ready && game.user.isGM, "Run in a ready world as a GM.");
  check(game.system.id === "starwarsffg" && game.modules.get(moduleId)?.active, "Activate the addon in a StarWarsFFG world.");

  let actor;
  let message;
  const scene = canvas.scene;
  let tokens = [];
  try {
    actor = await Actor.create({
      name: "FFG E2E • Perception • " + foundry.utils.randomID(),
      type: "character",
      ownership: { default: 0 },
      system: { characteristics: { Cunning: { value: 3 } } }
    }, { renderSheet: false });
    check(actor.getActiveTokens().length === 0, "The test needs a directory actor without a token.");
    check(!game.users.some(user => !user.isGM && actor.testUserPermission(user, "OWNER")), "The test actor must have no player owners.");

    const options = { ffgDifficulty: 0, rollMode, silent: true };
    if (contested) {
      check(scene && canvas.ready, "A contest needs an active scene.");
      const token = (await actor.getTokenDocument({ hidden: true, actorLink: true })).toObject();
      delete token._id;
      tokens = await scene.createEmbeddedDocuments("Token", [token, { ...token }]);
      const sides = await waitFor(() => tokens.every(doc => doc.object?.actor) && tokens.map(doc => doc.object), "The two private scene tokens did not load.");
      message = await game.MonksTokenBar.requestContestedRoll(
        { token: sides[0], request: "skill:perception" },
        { token: sides[1], request: "skill:discipline" }, options
      );
    } else {
      message = await game.MonksTokenBar.requestRoll(actor.uuid, { ...options, request: "skill:perception" });
    }
    check(message?.id, "The request did not create a chat message.");
    check(message.whisper.length === 1 && message.whisper[0] === game.user.id, "The request should reach only the testing GM.");
    const flags = message.flags["monks-tokenbar"];
    const targets = Object.entries(flags).filter(([key, entry]) => key.startsWith("token") && entry?.uuid);
    check(flags.rollmode === rollMode, "The request did not retain its roll mode.");
    const expectedTargets = contested ? tokens.map(token => token.uuid) : [actor.uuid];
    check(targets.length === expectedTargets.length && targets.every(([,entry]) => expectedTargets.includes(entry.uuid)),
      "The request should contain exactly the selected recipients.");
    const [flag, target] = targets[0];
    const rowSelector = `[data-message-id="${message.id}"] li.item[data-item-id="${target.id}"]`;
    const button = await waitFor(() => {
      const row = document.querySelector(rowSelector);
      const control = row?.querySelector(".item-roll");
      if (control && getComputedStyle(row).display !== "none" && getComputedStyle(control).display !== "none") return control;
    }, "The request row or roll button stayed hidden in the chat log.");

    // Other renderChatMessageHTML hooks can finish after the row first appears.
    await new Promise(resolve => setTimeout(resolve, 120));
    check(button === document.querySelector(rowSelector + " .item-roll"), "A render hook replaced the live roll button.");
    const activePrompt = () => Object.values(ui.windows)
      .find(app => app instanceof game.ffg.RollBuilderFFG && app.roll.data.actor?.id === actor.id && app.rendered);
    const openPrompt = async () => {
      document.querySelector(rowSelector + " .item-roll").click();
      return waitFor(() => activePrompt()?.element[0], "The request did not open the native pool editor.");
    };
    const newMessages = [];
    const messageHook = Hooks.on("createChatMessage", doc => {
      if (doc.speaker?.actor === actor.id) newMessages.push(doc.id);
    });
    try {
      const cancelled = await openPrompt();
      check(!message.flags["monks-tokenbar"][flag].roll, "The request rolled before confirmation.");
      // Foundry V14 ApplicationV1 deliberately delays its header-button listeners by 500 ms.
      await new Promise(resolve => setTimeout(resolve, 550));
      cancelled.querySelector('.window-header .close')?.click();
      await waitFor(() => !cancelled.isConnected, "The native editor did not close.");
      check(!message.flags["monks-tokenbar"][flag].roll, "Closing the editor recorded a roll.");
      const confirmed = await openPrompt();
      confirmed.querySelector('input[name="success"]').click();
      confirmed.querySelector('.btn').click();
      await waitFor(() => game.messages.get(message.id)?.flags["monks-tokenbar"]?.[flag]?.roll, "Confirming the pool did not update the request.");
      check(newMessages.length === 0, "Confirmation must update the request without publishing a standalone roll.");
    } finally {
      Hooks.off("createChatMessage", messageHook);
      if (activePrompt()) await activePrompt().close();
    }
    const entry = await waitFor(() => {
      const latest = game.messages.get(message.id)?.flags["monks-tokenbar"]?.[flag];
      if (latest?.error) throw new Error(latest.msg || "TokenBar reported a roll error.");
      if (latest?.roll) return latest;
    }, "The click did not save a roll on the request.");
    const symbols = entry.roll.options?.starwarsffgTokenbar;
    check(symbols && Object.keys(symbols).length === narrativeSymbols.length
      && narrativeSymbols.every(key => Number.isInteger(symbols[key])), "Expected all eight FFG symbol counts.");
    check(entry.roll.total === symbols.success - symbols.failure, "The numeric total must equal net successes.");
    check(symbols.success >= 1, "The automatic success added in the native form did not reach the roll.");
    const result = await waitFor(() => {
      const result = document.querySelector(rowSelector + " .swffg-tokenbar-result");
      return result?.textContent.trim() && getComputedStyle(result).display !== "none" && result;
    }, "The GM could not see the narrative result on the rolled card.");
    if (game.ffg.RollBuilderFFG.promptPool) {
      for (const key of narrativeSymbols.filter(key => symbols[key] > 0)) {
        check(result.querySelector(`[data-ffg-symbol="${key}"]`), `Missing system icon for ${key}.`);
      }
    }
    if (contested) check(!game.messages.get(message.id).flags["monks-tokenbar"][targets[1][0]].roll, "One side's confirmation rolled for the other side.");
    return { rollMode, contested, world: game.world.id, system: game.system.version, addon: game.modules.get(moduleId).version };
  } finally {
    try {
      if (message && game.messages.has(message.id)) await message.delete();
    } finally {
      try {
        if (tokens.length) await scene.deleteEmbeddedDocuments("Token", tokens.map(doc => doc.id));
      } finally {
        if (actor && game.actors.has(actor.id)) await actor.delete();
      }
    }
    check(!message || !game.messages.has(message.id), "The test message was not removed.");
    check(!actor || !game.actors.has(actor.id), "The test actor was not removed.");
  }
}
