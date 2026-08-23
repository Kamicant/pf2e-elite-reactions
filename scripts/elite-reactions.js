const MODULE_ID = "pf2e-elite-reactions";
const I18N = "PF2EEliteReactions";
const ICON_PATH = `modules/${MODULE_ID}/assets/elite-reaction-icon.webp`;

const FLAGS = Object.freeze({
  itemElite: "eliteReaction",
  actorEnabled: "enabled",
  actorValue: "value",
  actorMax: "max",
});

function localize(key, data = {}) {
  return game.i18n.format(`${I18N}.${key}`, data);
}

function isPF2e() {
  return game.system?.id === "pf2e";
}

function escapeHTML(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function toHTMLElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function getAppDocument(app) {
  return app?.document ?? app?.actor ?? app?.item ?? app?.object ?? null;
}

function getAppActor(app) {
  const doc = getAppDocument(app);
  return doc?.documentName === "Actor" ? doc : app?.actor ?? null;
}

function getAppItem(app) {
  const doc = getAppDocument(app);
  return doc?.documentName === "Item" ? doc : app?.item ?? null;
}

function isNPCActor(actor) {
  return actor?.documentName === "Actor" && actor.type === "npc";
}

function userCanEdit(app, document) {
  return Boolean(game.user?.isGM && (app?.isEditable ?? document?.isOwner ?? true));
}

function isSupportedItem(item) {
  return item && ["action", "feat"].includes(item.type) && item.system?.actionType?.value !== undefined;
}

function isEliteReactionItem(item) {
  return Boolean(
    isSupportedItem(item)
    && item.system?.actionType?.value === "reaction"
    && item.getFlag(MODULE_ID, FLAGS.itemElite) === true,
  );
}

function getActorPool(actor) {
  const max = Math.max(1, Number(actor.getFlag(MODULE_ID, FLAGS.actorMax) ?? 3) || 3);
  const rawValue = Number(actor.getFlag(MODULE_ID, FLAGS.actorValue) ?? max);
  const value = Math.max(0, Math.min(max, Number.isFinite(rawValue) ? rawValue : max));
  return {
    enabled: actor.getFlag(MODULE_ID, FLAGS.actorEnabled) === true,
    value,
    max,
  };
}

async function updateActorPool(actor, update) {
  const current = getActorPool(actor);
  const max = Math.max(1, Number(update.max ?? current.max) || 1);
  const value = Math.max(0, Math.min(max, Number(update.value ?? current.value) || 0));

  return actor.update({
    [`flags.${MODULE_ID}.${FLAGS.actorEnabled}`]: update.enabled ?? current.enabled,
    [`flags.${MODULE_ID}.${FLAGS.actorMax}`]: max,
    [`flags.${MODULE_ID}.${FLAGS.actorValue}`]: value,
  });
}

async function toggleEliteReactions(actor, enabled = null) {
  const pool = getActorPool(actor);
  const nextEnabled = enabled ?? !pool.enabled;
  await updateActorPool(actor, {
    enabled: nextEnabled,
    max: pool.max,
    value: nextEnabled ? pool.max : pool.value,
  });
  actor.sheet?.render?.(true);
}

function findActionsHeader(root) {
  const actionsLabel = game.i18n.localize("PF2E.ActionActionsLabel");
  const candidates = [
    ...root.querySelectorAll("h1,h2,h3,h4,header,.section-header,.item-list-header,.action-header"),
  ];

  return candidates.find((el) => el.textContent?.trim().includes(actionsLabel)) ?? null;
}

function patchItemSheet(app, html) {
  const root = toHTMLElement(html);
  const item = getAppItem(app);
  if (!root || !isSupportedItem(item)) return;

  const select = root.querySelector('select[name="system.actionType.value"]');
  if (!select || select.dataset.eliteReactionsPatched === "true") return;

  select.dataset.eliteReactionsPatched = "true";

  const eliteOption = document.createElement("option");
  eliteOption.value = "reaction";
  eliteOption.dataset.eliteReaction = "true";
  eliteOption.textContent = localize("EliteReaction");

  const normalReaction = select.querySelector('option[value="reaction"]');
  if (normalReaction) {
    normalReaction.after(eliteOption);
  } else {
    select.append(eliteOption);
  }

  if (isEliteReactionItem(item)) {
    eliteOption.selected = true;
  }

  const indicator = document.createElement("span");
  indicator.className = "pf2e-er-select-indicator";
  indicator.innerHTML = `<img src="${ICON_PATH}" alt=""> ${escapeHTML(localize("EliteReaction"))}`;
  select.insertAdjacentElement("afterend", indicator);

  const syncIndicator = () => {
    const selectedElite = select.selectedOptions?.[0]?.dataset.eliteReaction === "true";
    indicator.classList.toggle("er-hidden", !selectedElite);
  };
  syncIndicator();

  select.addEventListener("change", syncIndicator);

  select.addEventListener("change", async (event) => {
    const selectedOption = select.selectedOptions?.[0];
    const selectedElite = selectedOption?.dataset.eliteReaction === "true";
    const currentlyElite = isEliteReactionItem(item);

    if (selectedElite) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await item.update({
        "system.actionType.value": "reaction",
        "system.actions.value": null,
        [`flags.${MODULE_ID}.${FLAGS.itemElite}`]: true,
      });
      ui.notifications?.info(localize("Marked"));
      return;
    }

    if (currentlyElite) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const nextType = select.value;
      await item.update({
        "system.actionType.value": nextType,
        "system.actions.value": nextType === "action" ? 1 : null,
        [`flags.${MODULE_ID}.-=${FLAGS.itemElite}`]: null,
      });
      ui.notifications?.info(localize("Unmarked"));
    }
  }, { capture: true });
}

async function spendEliteReaction(actor, item) {
  const pool = getActorPool(actor);
  if (!pool.enabled) {
    ui.notifications?.warn(localize("Disabled", { actor: actor.name }));
    return;
  }

  if (pool.value <= 0) {
    ui.notifications?.warn(localize("Empty", { actor: actor.name }));
    return;
  }

  const remaining = pool.value - 1;
  await updateActorPool(actor, { value: remaining });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="pf2e chat-card"><strong>${localize("EliteReaction")}:</strong> ${localize("Spent", {
      actor: escapeHTML(actor.name),
      item: escapeHTML(item?.name ?? localize("EliteReaction")),
      remaining,
      max: pool.max,
    })}</div>`,
  });
}

function buildNPCPanel(actor, editable) {
  const pool = getActorPool(actor);
  const wrapper = document.createElement("section");
  wrapper.className = "pf2e-elite-reactions-panel";
  wrapper.dataset.eliteReactionsPanel = "true";

  wrapper.innerHTML = `
    <div class="er-title-row">
      <label class="er-title-label">
        <input type="checkbox" data-er-action="toggle" checked ${editable ? "" : "disabled"}>
        <img class="pf2e-er-icon" src="${ICON_PATH}" alt="">
        ${escapeHTML(localize("EliteReactions"))}
      </label>
      <button type="button" data-er-action="reset" title="${escapeHTML(localize("Reset"))}" ${editable ? "" : "disabled"}>
        <i class="fa-solid fa-rotate-right"></i>
      </button>
    </div>
    <div class="er-tracker">
      <button type="button" data-er-action="minus" ${editable ? "" : "disabled"}>−</button>
      <input type="number" min="0" data-er-field="value" value="${pool.value}" ${editable ? "" : "disabled"}>
      <span>/</span>
      <input type="number" min="1" data-er-field="max" value="${pool.max}" ${editable ? "" : "disabled"}>
      <button type="button" data-er-action="plus" ${editable ? "" : "disabled"}>+</button>
    </div>
    <p class="er-hint">${escapeHTML(localize("TrackerHint"))}</p>
  `;

  wrapper.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-er-action]");
    if (!button || !editable) return;

    const action = button.dataset.erAction;
    const current = getActorPool(actor);

    if (action === "minus") {
      await updateActorPool(actor, { value: current.value - 1 });
    } else if (action === "plus") {
      await updateActorPool(actor, { value: current.value + 1 });
    } else if (action === "reset") {
      await updateActorPool(actor, { enabled: true, value: current.max });
    }
  });

  wrapper.addEventListener("change", async (event) => {
    if (!editable) return;
    const target = event.target;
    const current = getActorPool(actor);

    if (target.matches?.('[data-er-action="toggle"]')) {
      await updateActorPool(actor, { enabled: target.checked, max: current.max, value: target.checked ? current.max : current.value });
      actor.sheet?.render?.(true);
    } else if (target.matches?.('[data-er-field="value"]')) {
      await updateActorPool(actor, { value: Number(target.value) });
    } else if (target.matches?.('[data-er-field="max"]')) {
      const max = Math.max(1, Number(target.value) || 3);
      await updateActorPool(actor, { max, value: Math.min(current.value, max) });
    }
  });

  return wrapper;
}

function patchEliteActionRows(actor, root, editable) {
  const pool = getActorPool(actor);
  if (!pool.enabled) return;

  const eliteItems = actor.items.filter(isEliteReactionItem);
  for (const item of eliteItems) {
    const row = root.querySelector(`[data-item-id="${item.id}"]`) ?? root.querySelector(`[data-item-id="${item._id}"]`);
    if (!row || row.dataset.eliteReactionsRowPatched === "true") continue;

    row.dataset.eliteReactionsRowPatched = "true";
    row.classList.add("pf2e-elite-reaction-item");

    const title = row.querySelector("h4, .item-name, .name, .action-name") ?? row.firstElementChild ?? row;
    const badge = document.createElement("span");
    badge.className = "pf2e-er-badge";
    badge.innerHTML = `<img src="${ICON_PATH}" alt=""> <span>${escapeHTML(localize("EliteReaction"))}</span>`;
    title.append(badge);

    if (editable) {
      const use = document.createElement("button");
      use.type = "button";
      use.className = "pf2e-er-use";
      use.dataset.erUse = item.id;
      use.innerHTML = `<img src="${ICON_PATH}" alt=""> <span>${escapeHTML(localize("Use"))}</span>`;
      use.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        spendEliteReaction(actor, item);
      });
      title.append(use);
    }
  }
}

function patchNPCSheet(app, html) {
  const root = toHTMLElement(html);
  const actor = getAppActor(app);
  if (!root || !isNPCActor(actor)) return;

  const editable = userCanEdit(app, actor);
  const pool = getActorPool(actor);

  // V0.2 behavior: keep ordinary monsters clean. If Elite Reactions are off,
  // do not insert the tracker into the NPC sheet body at all.
  if (pool.enabled && !root.querySelector('[data-elite-reactions-panel="true"]')) {
    const panel = buildNPCPanel(actor, editable);
    const header = findActionsHeader(root);

    if (header) {
      header.insertAdjacentElement("afterend", panel);
    } else {
      const main = root.querySelector('.tab[data-tab="main"]') ?? root.querySelector(".sheet-body") ?? root;
      main.prepend(panel);
    }
  }

  patchEliteActionRows(actor, root, editable);
}

function addActorHeaderButtonV1(app, buttons) {
  const actor = getAppActor(app);
  if (!isPF2e() || !isNPCActor(actor) || !game.user?.isGM) return;
  if (buttons.some((button) => button.class === "pf2e-er-header-toggle")) return;

  const pool = getActorPool(actor);
  buttons.unshift({
    label: pool.enabled ? localize("Disable") : localize("Enable"),
    class: "pf2e-er-header-toggle",
    icon: pool.enabled ? "fas fa-bolt" : "far fa-bolt",
    onclick: () => toggleEliteReactions(actor),
  });
}

function addActorHeaderButtonV2(app, controls) {
  const actor = getAppActor(app);
  if (!isPF2e() || !isNPCActor(actor) || !game.user?.isGM) return;
  if (controls.some((control) => control.action === "pf2e-er-toggle")) return;

  const pool = getActorPool(actor);
  controls.unshift({
    action: "pf2e-er-toggle",
    label: pool.enabled ? localize("Disable") : localize("Enable"),
    icon: `<img class="pf2e-er-header-icon" src="${ICON_PATH}" alt="">`,
    onClick: () => toggleEliteReactions(actor),
    visible: true,
  });
}

function patchByDocument(app, html) {
  const document = getAppDocument(app);
  if (document?.documentName === "Item") {
    patchItemSheet(app, html);
  } else if (document?.documentName === "Actor") {
    patchNPCSheet(app, html);
  }
}

Hooks.once("init", () => {
  if (!isPF2e()) return;
  console.log(`${MODULE_ID} | Initializing`);
});

// Foundry v13/v14 ApplicationV1 sheets.
Hooks.on("renderItemSheet", (app, html) => {
  if (!isPF2e()) return;
  patchItemSheet(app, html);
});

Hooks.on("renderActorSheet", (app, html) => {
  if (!isPF2e()) return;
  patchNPCSheet(app, html);
});

Hooks.on("getApplicationV1HeaderButtons", addActorHeaderButtonV1);

// Foundry v14 ApplicationV2 sheets. PF2e can change sheet class names, so use the generic hook.
Hooks.on("renderApplicationV2", (app, html) => {
  if (!isPF2e()) return;
  patchByDocument(app, html);
});

Hooks.on("getHeaderControlsApplicationV2", addActorHeaderButtonV2);

// PF2e class-specific hooks kept as low-cost fallbacks for sheet-class changes.
Hooks.on("renderAbilitySheetPF2e", (app, html) => {
  if (!isPF2e()) return;
  patchItemSheet(app, html);
});

Hooks.on("renderFeatSheetPF2e", (app, html) => {
  if (!isPF2e()) return;
  patchItemSheet(app, html);
});

Hooks.on("renderNPCSheetPF2e", (app, html) => {
  if (!isPF2e()) return;
  patchNPCSheet(app, html);
});
