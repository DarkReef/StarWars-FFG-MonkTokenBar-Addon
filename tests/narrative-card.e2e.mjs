// Run as GM and as an ordinary player in a ready world:
// await (await import("/modules/starwars-ffg-monktokenbar-addon/tests/narrative-card.e2e.mjs")).verifyNarrativeCards()
// The adapter evaluates real rolls, and TokenBar renders its installed templates.
// All messages and their DOM are created in memory. No world documents are saved.
import {MonksTokenBar} from "../../monks-tokenbar/monks-tokenbar.js";
import {renderResults} from "../scripts/results.js";

const check = (condition, message) => { if (!condition) throw new Error(message); };
const symbols = ["success", "failure", "advantage", "threat", "triumph", "despair", "light", "dark"];
const noResults = Object.fromEntries(symbols.map(key => [key, 0]));

async function rollEntry(id, name, difficulty, additions, modifiers = {}) {
  const actor = {name, isOwner: true, system: {
    characteristics: {Cunning: {value: 0}},
    skills: {Perception: {label: "SWFFG.SkillsPerception", characteristic: "Cunning", rank: 0, ...additions}}
  }};
  const request = {type: "skill", key: "perception", name: "Восприятие", ffgDifficulty: difficulty, ffgModifiers: modifiers};
  const summary = await MonksTokenBar.system.roll({id, actor, request, fastForward: true}, roll => roll);
  check(summary instanceof Roll, "The registered adapter did not return its serializable summary.");
  const roll = JSON.parse(JSON.stringify(summary));
  return {id, name, realname: name, showname: true, showtoken: true, reveal: true, requests: [request], request, roll, total: roll.total};
}

async function card(tokens, {mode = "roll", dc = 1, contested = false, visible = true, contentVisible = true} = {}) {
  const what = contested ? "contestedroll" : "savingthrow";
  const flags = {what, dc, rollmode: mode, showdc: true, name: "Восприятие", requests: [tokens[0].request]};
  for (const token of tokens) flags["token" + token.id] = token;
  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/monks-tokenbar/templates/${what}/chat-message.html`, {...flags, tokens}
  );
  const doc = new foundry.documents.ChatMessage.implementation({content, author: game.user.id, flags: {"monks-tokenbar": flags}});
  const html = document.createElement("div");
  html.innerHTML = doc.content;
  const message = visible && contentVisible ? doc : {flags: doc.flags, visible, isContentVisible: contentVisible};
  if (visible && contentVisible) {
    // Rolled TokenBar messages persist these nodes in their HTML, even for blind rolls.
    for (const token of tokens) {
      if (!token.roll) continue;
      const native = document.createElement("div");
      native.className = "dice-total";
      native.innerHTML = '<div class="dice-result reveal"><span class="smoke-screen">...</span><span class="total"></span></div>';
      native.querySelector(".total").textContent = String(token.roll.total);
      html.querySelector(`[data-item-id="${token.id}"] .roll-controls`).append(native);
    }
  }
  const controls = new Map(Array.from(html.querySelectorAll(".item-roll"), control =>
    [control.closest("[data-item-id]").dataset.itemId, control]));
  let clicks = 0;
  for (const control of controls.values()) control.addEventListener("click", () => clicks++);
  await renderResults(message, html);
  await renderResults(message, html);
  const accessibleRows = Array.from(html.querySelectorAll(".item[data-item-id]"));
  for (const row of accessibleRows) {
    const control = row.querySelector(".item-roll");
    check(control && controls.get(row.dataset.itemId) === control, "Rendering replaced a TokenBar roll button.");
    control.click();
  }
  check(clicks === accessibleRows.length, "Rendering removed a TokenBar listener.");
  return html;
}

function row(html, entry) {
  const node = html.querySelector(`li.item[data-item-id="${entry.id}"]`);
  check(node?.querySelectorAll("[data-ffg-check]").length === 1, "Expected exactly one narrative result per row after rerender.");
  return node;
}

function expectResult(node, outcome, present, absent) {
  check(node.querySelector(`[data-ffg-state="${outcome}"] [data-ffg-outcome="${outcome}"]`), "Incorrect narrative outcome: " + outcome);
  for (const key of present) check(node.querySelector(`[data-ffg-symbols] [data-ffg-symbol="${key}"]`), "Missing independent result " + key);
  for (const key of absent) check(!node.querySelector(`[data-ffg-symbols] [data-ffg-symbol="${key}"]`), "Unexpected result " + key);
}

function expectNoResult(html, reason) {
  const privateData = ['[data-ffg-outcome="success"]', '[data-ffg-outcome="failure"]',
    '[data-ffg-state="success"]', '[data-ffg-state="failure"]', "[data-ffg-symbols]",
    "[data-ffg-symbol]", "[data-ffg-count]", "[data-ffg-pool]", "[data-die]", "[data-ffg-contest]",
    "[data-ffg-modifiers]", "[data-ffg-threshold]", "[data-ffg-adjudication]", ".dice-result .total", ".dice-tooltip"];
  check(!html.querySelector(privateData.join(",")),
    "Result information exposed for " + reason);
}

export async function verifyNarrativeCards() {
  check(game.ready && game.system.id === "starwarsffg", "Run inside a ready StarWarsFFG world.");
  const win = await rollEntry("NarrativeTest001", "A", 0, {success: 1, threat: 2});
  const loss = await rollEntry("NarrativeTest002", "B", 0, {failure: 1, advantage: 2});
  const blank = await rollEntry("NarrativeTest003", "C", 0, {success: 1, failure: 1, advantage: 2});
  const pureWin = await rollEntry("NarrativeTest005", "E", 0, {success: 2, failure: 1, advantage: 1, threat: 1});
  const pureLoss = await rollEntry("NarrativeTest006", "F", 0, {failure: 1});
  check(win.roll.total === 1 && loss.roll.total === -1 && blank.roll.total === 0, "Unexpected totals from the native FFG roll.");
  for (const [entry, expected] of [[win, {success: 1, threat: 2}], [loss, {failure: 1, advantage: 2}],
    [blank, {advantage: 2}], [pureWin, {success: 1}], [pureLoss, {failure: 1}]]) {
    const actual = entry.roll.options.starwarsffgTokenbar;
    check(symbols.every(key => actual[key] === ({...noResults, ...expected})[key]), "Opposite symbols failed to cancel independently.");
  }
  const ordinary = await card([win, loss, blank, pureWin, pureLoss]);
  expectResult(row(ordinary, win), "success", ["success", "threat"], ["failure", "advantage"]);
  expectResult(row(ordinary, loss), "failure", ["failure", "advantage"], ["success", "threat"]);
  expectResult(row(ordinary, blank), "failure", ["advantage"], ["success", "failure"]);
  expectResult(row(ordinary, pureWin), "success", ["success"], ["failure", "threat", "advantage"]);
  expectResult(row(ordinary, pureLoss), "failure", ["failure"], ["success", "threat", "advantage"]);
  check(row(ordinary, win).querySelector('[data-ffg-difficulty="0"]'), "A simple check must retain difficulty zero.");

  const adjusted = await rollEntry("NarrativeTest004", "D", 3, {success: 12}, {upgradeDifficulty: 1, setback: 1});
  const actualPool = adjusted.roll.options.starwarsffgCheck?.pool;
  check(actualPool?.difficulty === 2 && actualPool.challenge === 1 && actualPool.setback === 1, "The roll did not preserve the final upgraded dice.");
  const adjustedRow = row(await card([adjusted]), adjusted);
  check(adjustedRow.querySelector('[data-ffg-difficulty="3"]'), "Requested difficulty should stay at three.");
  for (const [key, count] of Object.entries({difficulty: 2, challenge: 1, setback: 1})) {
    check(adjustedRow.querySelector(`[data-ffg-pool] [data-die="${key}"][data-count="${count}"]`), "Wrong confirmed quantity for " + key);
  }

  // A previously saved check can have dc=3, passed=false and one net success.
  // Old messages contain narrative symbols, but did not store the confirmed dice.
  const legacy = structuredClone(win);
  delete legacy.roll.options.starwarsffgCheck;
  legacy.request.ffgDifficulty = 3;
  legacy.passed = false;
  const old = row(await card([legacy], {dc: "3"}), legacy);
  expectResult(old, "success", ["success", "threat"], ["failure", "advantage"]);
  check(old.querySelector('[data-ffg-difficulty="3"]') && !old.querySelector("[data-ffg-pool] [data-die]"),
    "Old messages must show requested difficulty without inventing a confirmed pool.");
  if (game.user.isGM) check(old.querySelector('[data-ffg-threshold="3"]'), "Custom DC is a separate threshold.");

  const contest = await card([win, loss], {contested: true});
  expectResult(row(contest, win), "success", ["success", "threat"], ["failure", "advantage"]);
  expectResult(row(contest, loss), "failure", ["failure", "advantage"], ["success", "threat"]);
  check(row(contest, win).querySelector('[data-ffg-contest="won"]') && row(contest, loss).querySelector('[data-ffg-contest="lost"]'), "Contest winner and loser were not recorded independently.");
  const tied = await card([win, {...win, id: loss.id}], {contested: true});
  check(tied.querySelectorAll('[data-ffg-contest="tied"]').length === 2, "A tied contest must show neither side as winner.");
  const unrevealed = await card([win, {...loss, reveal: false}], {contested: true});
  const hiddenOpponent = row(unrevealed, loss);
  expectNoResult(hiddenOpponent, "unrevealed opponent");
  check(hiddenOpponent.querySelector('[data-ffg-state="unrevealed"] [data-ffg-outcome="unrevealed"]'),
    "An unrevealed public opponent needs a neutral status.");
  check(!unrevealed.querySelector("[data-ffg-contest]"), "A contest badge disclosed its hidden opponent.");
  for (const options of [{visible: false}, {contentVisible: false}]) {
    expectNoResult(await card([win], options), "invisible message");
  }
  for (const mode of ["blindroll", "gmroll", "selfroll"]) {
    const privateCard = await card([win, loss], {mode, contested: true});
    if (game.user.isGM) expectResult(row(privateCard, win), "success", ["success", "threat"], ["failure"]);
    else {
      expectNoResult(privateCard, mode + " on non-owner player client");
      if (mode === "gmroll") check(row(privateCard, win).querySelector('[data-ffg-outcome="hidden"]'), "Expected neutral status for private result.");
      else check(!privateCard.querySelector("[data-ffg-check]"), "A non-owner saw a restricted row.");
    }
  }
  let ownerPrivacy = false;
  if (!game.user.isGM) {
    const hiddenNPC = await card([{...win, npc: true, showtoken: false}]);
    expectNoResult(hiddenNPC, "public card with a hidden NPC");
    check(!hiddenNPC.querySelector("[data-ffg-check]"), "A hidden NPC gained a public panel.");
    const actor = game.actors.find(actor => actor.isOwner);
    if (actor) {
      const owned = {...win, uuid: actor.uuid};
      const whispered = row(await card([owned], {mode: "gmroll"}), owned);
      expectResult(whispered, "success", ["success", "threat"], ["failure"]);
      const blind = row(await card([owned], {mode: "blindroll"}), owned);
      expectNoResult(blind, "blind roll owned by the viewing player");
      check(blind.querySelector('[data-ffg-outcome="hidden"]'), "Ownership disclosed a blind roll.");
      ownerPrivacy = true;
    }
  }
  return {role: game.user.isGM ? "GM" : "player", ordinary: true, contested: true, legacy: true, privacy: true, ownerPrivacy};
}
