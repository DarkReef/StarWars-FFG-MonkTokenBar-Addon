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

export function renderResults(message, html) {
  const flags = message.flags?.["monks-tokenbar"];
  if (!flags || message.visible === false || message.isContentVisible === false) return;

  const card = html.querySelector(".monks-tokenbar.savingthrow, .monks-tokenbar.contested-roll");
  if (!card) return;

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
    const labels = [];
    for (const [key, label] of Object.entries(symbolLabels)) {
      const count = symbols[key];
      if (Number.isSafeInteger(count) && count > 0) {
        labels.push(`${game.i18n.localize(`SWFFGMTB.${label}`)} ×${count}`);
      }
    }
    result.textContent = labels.length ? labels.join(" · ") : game.i18n.localize("SWFFGMTB.NoSymbols");
    row.querySelector(".dice-roll")?.append(result);
  }
}
