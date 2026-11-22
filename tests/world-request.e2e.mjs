// From a GM browser with the source checkout installed, leave the chat log available:
// const { verifyWorldRequest } = await import("/modules/starwars-ffg-monktokenbar-addon/tests/world-request.e2e.mjs");
// await verifyWorldRequest("selfroll");
// await verifyWorldRequest("blindroll");

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

export async function verifyWorldRequest(rollMode = "selfroll") {
  check(["blindroll", "selfroll"].includes(rollMode), "Choose blindroll or selfroll for this private test.");
  check(game.ready && game.user.isGM, "Run in a ready world as a GM.");
  check(game.system.id === "starwarsffg" && game.modules.get(moduleId)?.active, "Activate the addon in a StarWarsFFG world.");

  let actor;
  let message;
  try {
    actor = await Actor.create({
      name: "FFG E2E • Perception • " + foundry.utils.randomID(),
      type: "character",
      ownership: { default: 0 },
      system: { characteristics: { Cunning: { value: 3 } } }
    }, { renderSheet: false });
    check(actor.getActiveTokens().length === 0, "The test needs a directory actor without a token.");
    check(!game.users.some(user => !user.isGM && actor.testUserPermission(user, "OWNER")), "The test actor must have no player owners.");

    message = await game.MonksTokenBar.requestRoll(actor.uuid, {
      request: "skill:perception", ffgDifficulty: 0, rollMode, silent: true
    });
    check(message?.id, "The request did not create a chat message.");
    check(message.whisper.length === 1 && message.whisper[0] === game.user.id, "The request should reach only the testing GM.");
    const flags = message.flags["monks-tokenbar"];
    const targets = Object.entries(flags).filter(([key, entry]) => key.startsWith("token") && entry?.uuid);
    check(flags.rollmode === rollMode, "The request did not retain its roll mode.");
    check(targets.length === 1 && targets[0][1].uuid === actor.uuid, "The sole recipient should be the directory actor.");
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
    button.click();
    const entry = await waitFor(() => {
      const latest = game.messages.get(message.id)?.flags["monks-tokenbar"]?.[flag];
      if (latest?.error) throw new Error(latest.msg || "TokenBar reported a roll error.");
      if (latest?.roll) return latest;
    }, "The click did not save a roll on the request.");
    const symbols = entry.roll.options?.starwarsffgTokenbar;
    check(symbols && Object.keys(symbols).length === narrativeSymbols.length
      && narrativeSymbols.every(key => Number.isInteger(symbols[key])), "Expected all eight FFG symbol counts.");
    check(entry.roll.total === symbols.success - symbols.failure, "The numeric total must equal net successes.");
    await waitFor(() => {
      const result = document.querySelector(rowSelector + " .swffg-tokenbar-result");
      return result?.textContent.trim() && getComputedStyle(result).display !== "none";
    }, "The GM could not see the narrative result on the rolled card.");
    return { rollMode, world: game.world.id, system: game.system.version, addon: game.modules.get(moduleId).version };
  } finally {
    try {
      if (message && game.messages.has(message.id)) await message.delete();
    } finally {
      if (actor && game.actors.has(actor.id)) await actor.delete();
    }
    check(!message || !game.messages.has(message.id), "The test message was not removed.");
    check(!actor || !game.actors.has(actor.id), "The test actor was not removed.");
  }
}
