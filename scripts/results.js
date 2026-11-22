import { readCheckOutcome } from "./ffg-roll.js";
import { die } from "./request-editor.js";
import { skillKey } from "./requests.js";

const codes = { success: "SU", failure: "FA", advantage: "AD", threat: "TH", triumph: "TR", despair: "DE", light: "LI", dark: "DA" };
const dice = { ability: "a", proficiency: "p", boost: "b", difficulty: "i", challenge: "c", setback: "s", force: "f" };
const tr = key => game.i18n.localize("SWFFGMTB." + key);
const format = (key, data) => game.i18n.format("SWFFGMTB." + key, data);
let resultIcons;
const rendering = new WeakMap();

async function iconFactory() {
  if (game.ffg?.RollBuilderFFG?.promptPool) {
    resultIcons ??= import("../../../systems/starwarsffg/modules/dice/result-icons.mjs").catch(() => null);
    const icons = await resultIcons;
    if (icons?.createResultIcon) return icons.createResultIcon;
  }
  return (key, { document }) => {
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.dataset.ffgSymbol = key;
    icon.textContent = "[" + codes[key] + "]";
    game.ffg?.addons?.PopoutEditor?.renderChatDiceImages?.(icon);
    return icon;
  };
}

export function canShowResult({ rollMode, isGM, isOwner, revealed, showToken = true }) {
  if (!revealed) return false;
  if (isGM) return true;
  return showToken && (rollMode === "roll" || (rollMode === "gmroll" && isOwner));
}

function ownsEntry(entry) {
  if (!entry.uuid) return false;
  try {
    const doc = foundry.utils.fromUuidSync(entry.uuid);
    return Boolean((doc?.actor ?? doc)?.isOwner);
  } catch {
    return false;
  }
}

function canRead(flags, entry, viewer) {
  return canShowResult({
    rollMode: flags.rollmode, isGM: viewer.isGM, isOwner: flags.rollmode === "gmroll" && viewer.owns(entry),
    revealed: entry.reveal === true, showToken: entry.showtoken !== false
  });
}

function cardRequests(flags, entry) {
  return entry.request ? [entry.request] : entry.requests ?? flags.requests ?? [];
}

function skillRequests(requests) {
  return requests.length > 0 && requests.every(request => request.type === "skill");
}

function contestResult(flags, entry, viewer, outcome) {
  if (flags.what !== "contestedroll" || (!viewer.isGM && flags.rollmode !== "roll")) return null;
  const sides = Object.entries(flags).filter(([key, value]) => key.startsWith("token") && value?.id).map(([, value]) => value);
  if (sides.length !== 2 || !sides.every(side => canRead(flags, side, viewer))) return null;
  const other = sides.find(side => side.id !== entry.id);
  const opponent = other && readCheckOutcome(other);
  if (!opponent) return null;
  // TokenBar saves the GM's tie-break or winner selection in the same flag.
  if (entry.passed === "won" || entry.passed === "tied") return entry.passed;
  if (entry.passed === "failed") return "lost";
  if (outcome.netSuccess === opponent.netSuccess) return "tied";
  return outcome.netSuccess > opponent.netSuccess ? "won" : "lost";
}

export function describeCardRow(flags, entry, viewer) {
  if (!entry || (!viewer.isGM && (entry.showtoken === false || flags.rollmode === "selfroll"))) return null;
  const requests = cardRequests(flags, entry);
  if (!skillRequests(requests)) return null;
  if (!viewer.isGM && flags.rollmode === "blindroll" && !viewer.owns(entry)) return null;
  const authorized = canRead(flags, entry, viewer);
  // An actual skill choice, unlike the offered skills, can reveal a concealed roll.
  const offered = entry.requests ?? flags.requests ?? [];
  const publicRequests = !authorized && entry.roll ? offered.filter(request => request.type === "skill") : requests;
  const difficulties = [...new Set(publicRequests.map(r => r.ffgDifficulty)
    .filter(d => (typeof d === "number" || typeof d === "string" && d.trim()) && /^[0-5]$/.test(String(d)))
    .map(Number))];
  const row = {
    requests: publicRequests, difficulty: difficulties.length === 1 ? difficulties[0] : null,
    state: "pending", outcome: null, threshold: null, contest: null, adjudication: null
  };
  if (!entry.roll && !entry.error) return row;
  if (!authorized) {
    row.state = (viewer.isGM || flags.rollmode === "roll" || flags.rollmode === "gmroll" && viewer.owns(entry)) ? "unrevealed" : "hidden";
    return row;
  }
  const outcome = entry.error ? null : readCheckOutcome(entry, flags.dc);
  if (!outcome) return { ...row, state: "error" };
  row.outcome = outcome;
  row.state = outcome.succeeded ? "success" : "failure";
  if (outcome.skillKey && row.requests.length > 1) {
    const actual = row.requests.find(r => r.key === skillKey(outcome.skillKey));
    if (actual) row.requests = [actual];
  }
  row.difficulty = outcome.requestedDifficulty ?? row.difficulty;
  if (flags.what !== "contestedroll" && outcome.threshold > 1 && (viewer.isGM || flags.showdc)) {
    row.threshold = { value: outcome.threshold, met: outcome.meetsThreshold };
  }
  if (flags.what === "contestedroll") row.contest = contestResult(flags, entry, viewer, outcome);
  else if (viewer.isGM) {
    const passed = { true: true, success: true, false: false, failed: false }[entry.passed];
    if (typeof passed === "boolean" && passed !== (outcome.meetsThreshold ?? outcome.succeeded)) {
      row.adjudication = passed ? "MarkedPassed" : "MarkedFailed";
    }
  }
  return row;
}

function part(doc, tag, attribute, value, text) {
  const node = doc.createElement(tag);
  node.setAttribute("data-ffg-" + attribute, value ?? "");
  if (text != null) node.textContent = text;
  return node;
}

function skillLabel(request) {
  const skills = globalThis.CONFIG?.FFG?.skills ?? {};
  const key = Object.keys(skills).find(key => skillKey(key) === request.key);
  if (key) return game.i18n.localize(skills[key]?.label || key);
  return request.name || request.key;
}

function paintPool(doc, container, pool) {
  if (!pool) return;
  const line = part(doc, "div", "pool");
  line.append(part(doc, "span", "caption", "", tr("FinalPool")));
  for (const [key, code] of Object.entries(dice)) {
    const count = pool[key];
    if (!Number.isSafeInteger(count) || count < 1) continue;
    const term = doc.createElement("span");
    term.dataset.die = key;
    term.dataset.count = String(count);
    term.append(die(code, doc), "×" + count);
    line.append(term);
  }
  if (line.childElementCount === 1) line.append(tr("EmptyDice"));
  container.append(line);
}

function countLabel(key, n) {
  const base = "ResultCounts." + key + ".";
  const category = new Intl.PluralRules(game.i18n.lang).select(Math.abs(n));
  const keyWithForm = base + category;
  const text = format(keyWithForm, { n });
  return text === "SWFFGMTB." + keyWithForm ? format(base + "other", { n }) : text;
}

function paintSymbols(doc, container, symbols, createIcon, automatic = false) {
  if (!symbols) return;
  const group = part(doc, "div", automatic ? "modifiers" : "symbols");
  if (!automatic) group.className = "swffg-tokenbar-result";
  for (const key of Object.keys(codes)) {
    const n = symbols[key];
    if (!Number.isSafeInteger(n) || n === 0 || (!automatic && n < 0)) continue;
    const text = (automatic && n > 0 ? "+" : "") + countLabel(key, n);
    const chip = part(doc, "span", "count", String(n));
    chip.append(createIcon(key, { document: doc }), text);
    group.append(chip);
  }
  if (automatic && !group.childElementCount) return;
  if (automatic) group.prepend(part(doc, "span", "caption", "", tr("FlatSymbols")));
  if (!group.childElementCount) group.textContent = tr("NoSymbols");
  container.append(group);
}

function paintRow(doc, row, data, createIcon) {
  const panel = part(doc, "section", "check");
  panel.dataset.ffgState = data.state;
  const meta = part(doc, "div", "context");
  if (data.requests.length) meta.append(part(doc, "span", "skill", "", data.requests.map(skillLabel).join(" / ")));
  if (data.difficulty !== null) {
    meta.append(part(doc, "span", "difficulty", String(data.difficulty), tr("AssignedDifficulty") + " " + tr("Difficulty" + data.difficulty)));
  }
  if (meta.childElementCount) panel.append(meta);
  const states = { pending: "AwaitingRoll", hidden: "PrivateResult", unrevealed: "AwaitingReveal", error: "UnavailableResult", success: "CheckSucceeded", failure: "CheckFailed" };
  const outcome = part(doc, "strong", "outcome", data.state, tr(states[data.state]));
  panel.append(outcome);
  if (data.contest) {
    const key = { won: "ContestWon", lost: "ContestLost", tied: "ContestTied" }[data.contest];
    panel.append(part(doc, "span", "contest", data.contest, tr(key)));
  }
  if (data.outcome) {
    paintSymbols(doc, panel, data.outcome.symbols, createIcon);
    paintPool(doc, panel, data.outcome.pool);
    paintSymbols(doc, panel, data.outcome.modifiers, createIcon, true);
  }
  if (data.threshold) {
    const { value, met } = data.threshold;
    panel.append(part(doc, "span", "threshold", String(value), format(met ? "ThresholdMet" : "ThresholdMissed", { n: value })));
  }
  if (data.adjudication) panel.append(part(doc, "span", "adjudication", "", tr(data.adjudication)));
  const container = row.querySelector(".dice-roll");
  if (container) container.insertBefore(panel, container.querySelector(":scope > [data-ffg-gm-controls]"));
}

// Keep TokenBar's original action nodes and their listeners for rolling,
// revealing and GM adjudication. The numeric tooltip only holds the transport Roll.
function prepareControls(row, data, isGM) {
  row.dataset.ffgRow = data.state;
  row.querySelectorAll(".dice-tooltip, .dice-tooltip-collapser, .dice-text, .dice-result .total, .dice-result .smoke-screen").forEach(el => el.remove());
  const result = row.querySelector(".roll-controls .dice-result");
  if (data.state === "unrevealed" && isGM && result) {
    const button = row.ownerDocument.createElement("button");
    button.type = "button";
    button.textContent = tr("RevealResult");
    // The click bubbles to TokenBar's native reveal handler.
    result.replaceChildren(button);
  } else if (result) {
    result.replaceChildren();
    result.removeAttribute("title");
  }
  if (!isGM) {
    row.querySelectorAll(".roll-result, .result-passed, .result-failed, [data-ffg-gm-controls]").forEach(el => el.remove());
    return;
  }
  // Native flags also track optional targets and GM overrides. Keep these
  // actions separate from the narrative outcome, with the original listeners.
  const doc = row.ownerDocument;
  const tools = row.querySelector("[data-ffg-gm-controls]") ?? part(doc, "details", "gm-controls");
  if (!tools.firstElementChild) tools.append(part(doc, "summary", "caption", "", tr("GMDecision")));
  for (const [selector, key] of [[".result-passed", data.threshold ? "MarkTargetMet" : "MarkPassed"],
    [".result-failed", data.threshold ? "MarkTargetMissed" : "MarkFailed"], [".roll-result", "MarkWinner"]]) {
    const control = row.querySelector(selector);
    if (control) {
      control.title = tr(key);
      control.setAttribute("aria-label", control.title);
      if (!control.hasAttribute("href")) {
        control.setAttribute("href", "#");
        control.addEventListener("click", event => event.preventDefault());
      }
      let caption = control.querySelector("[data-ffg-caption]");
      if (!caption) {
        caption = part(doc, "span", "caption");
        control.append(caption);
      }
      caption.textContent = control.title;
      tools.append(control);
    }
  }
  tools.hidden = !data.outcome;
  if (tools.childElementCount > 1) row.querySelector(".dice-roll")?.append(tools);
}

export async function renderResults(message, html) {
  const flags = message.flags?.["monks-tokenbar"];
  const card = html.querySelector(".monks-tokenbar.savingthrow, .monks-tokenbar.contested-roll");
  if (!flags || !card) return;
  const ticket = {};
  rendering.set(card, ticket);
  card.querySelectorAll("[data-ffg-check]").forEach(node => node.remove());
  if (message.visible === false || message.isContentVisible === false) { card.remove(); return; }

  const viewer = { isGM: game.user.isGM, owns: ownsEntry };
  const entries = Object.entries(flags).filter(([key, value]) => key.startsWith("token") && value?.id).map(([, entry]) => entry);
  const onlySkills = entries.length && entries.every(entry => {
    const requests = entry.requests ?? flags.requests ?? [];
    return skillRequests(requests);
  });
  if (onlySkills) {
    card.querySelector(".card-header > .item-controls")?.remove();
    card.querySelector(".group-dc")?.parentElement?.remove();
    // A hidden side's skill must not survive in TokenBar's shared contest header.
    card.querySelector(".card-header .request-name")?.parentElement?.remove();
  }
  const exposed = [];
  for (const row of card.querySelectorAll(".item[data-item-id]")) {
    const entry = flags["token" + row.dataset.itemId];
    const data = describeCardRow(flags, entry, viewer);
    if (!data) {
      if (entry && skillRequests(cardRequests(flags, entry))) row.remove();
      continue;
    }
    prepareControls(row, data, viewer.isGM);
    if (data.outcome) exposed.push([row, data]);
    else paintRow(row.ownerDocument, row, data);
  }
  if (!exposed.length) return;
  const createIcon = await iconFactory();
  if (rendering.get(card) !== ticket) return;
  for (const [row, data] of exposed) paintRow(row.ownerDocument, row, data, createIcon);
}

