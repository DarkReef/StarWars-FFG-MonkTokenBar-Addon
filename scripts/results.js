const symbolLabels = {
  success: "Success",
  failure: "Failure",
  advantage: "Advantage",
  threat: "Threat",
  triumph: "Triumph",
  despair: "Despair",
  light: "Light",
  dark: "Dark"
};
const symbolCodes = { success: "SU", failure: "FA", advantage: "AD", threat: "TH", triumph: "TR", despair: "DE", light: "LI", dark: "DA" };
let resultIcons;

async function iconFactory() {
  if (game.ffg?.RollBuilderFFG?.promptPool) {
    resultIcons ??= import("../../../systems/starwarsffg/modules/dice/result-icons.mjs").catch(() => null);
    const icons = await resultIcons;
    if (icons?.createResultIcon) return icons.createResultIcon;
  }
  return (key, { label }) => {
    const icon = document.createElement("span");
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", label);
    icon.textContent = `[${symbolCodes[key]}]`;
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
    const document = foundry.utils.fromUuidSync(entry.uuid);
    return Boolean((document?.actor ?? document)?.isOwner);
  } catch {
    return false;
  }
}

export async function renderResults(message, html) {
  const flags = message.flags?.["monks-tokenbar"];
  if (!flags || message.visible === false || message.isContentVisible === false) return;

  const card = html.querySelector(".monks-tokenbar.savingthrow, .monks-tokenbar.contested-roll");
  if (!card) return;

  const createIcon = await iconFactory();
  for (const row of card.querySelectorAll(".item[data-item-id]")) {
    row.querySelector(".swffg-tokenbar-result")?.remove();
    const entry = flags[`token${row.dataset.itemId}`];
    const symbols = entry?.roll?.options?.starwarsffgTokenbar;
    if (!symbols || !canShowResult({
      rollMode: flags.rollmode,
      isGM: game.user.isGM,
      isOwner: !game.user.isGM && flags.rollmode === "gmroll" && ownsEntry(entry),
      revealed: entry.reveal === true,
      showToken: entry.showtoken !== false && !row.classList.contains("gm-only")
    })) continue;

    const result = row.ownerDocument.createElement("div");
    result.className = "swffg-tokenbar-result";
    for (const [key, label] of Object.entries(symbolLabels)) {
      const count = symbols[key];
      if (Number.isSafeInteger(count) && count > 0) {
        const name = game.i18n.localize(`SWFFGMTB.${label}`);
        const group = row.ownerDocument.createElement("span");
        group.title = name;
        group.append(createIcon(key, { label: name }), ` ×${count}`);
        if (result.childNodes.length) result.append(" · ");
        result.append(group);
      }
    }
    if (!result.childNodes.length) result.textContent = game.i18n.localize("SWFFGMTB.NoSymbols");
    row.querySelector(".dice-roll")?.append(result);
  }
}
