const MODULE_ID = "pf2e-elite-reactions";
const I18N = "PF2EEliteReactions";
const ICON_PATH = `modules/${MODULE_ID}/assets/elite-reaction-icon.webp`;

const ACTOR_TRAIT = "boss-reactions";
const ITEM_TRAIT = "boss-reaction";

const FLAGS = Object.freeze({
  legacyItemElite: "eliteReaction",
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
  if (foundry.utils?.escapeHTML) return foundry.utils.escapeHTML(String(value ?? ""));
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function toHTMLElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (html instanceof DocumentFragment) return html.firstElementChild;
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

function normalizeSlug(value) {
  return String(value ?? "").trim().toLowerCase();
}

function traitValueArray(document) {
  const raw = document?.system?.traits?.value;
  if (raw instanceof Set) return Array.from(raw).map(normalizeSlug).filter(Boolean);
  if (Array.isArray(raw)) return raw.map(normalizeSlug).filter(Boolean);
  if (typeof raw === "string") return raw.split(/[;,]/).map(normalizeSlug).filter(Boolean);
  if (raw && typeof raw === "object") return Object.values(raw).map(normalizeSlug).filter(Boolean);
  return [];
}

function hasTrait(document, trait) {
  return traitValueArray(document).includes(normalizeSlug(trait));
}

async function setTrait(document, trait, enabled) {
  const current = traitValueArray(document);
  const slug = normalizeSlug(trait);
  const next = enabled
    ? Array.from(new Set([...current, slug])).sort()
    : current.filter((value) => value !== slug);

  return document.update({ "system.traits.value": next });
}

function hasBossReactionPool(actor) {
  return isNPCActor(actor) && hasTrait(actor, ACTOR_TRAIT);
}

function isSupportedItem(item) {
  return item && ["action", "feat"].includes(item.type) && item.system?.traits?.value !== undefined;
}

function isBossReactionItem(item) {
  return Boolean(
    isSupportedItem(item)
    && (hasTrait(item, ITEM_TRAIT) || item.getFlag(MODULE_ID, FLAGS.legacyItemElite) === true),
  );
}

function getActorPool(actor) {
  const max = Math.max(1, Number(actor.getFlag(MODULE_ID, FLAGS.actorMax) ?? 3) || 3);
  const rawValue = Number(actor.getFlag(MODULE_ID, FLAGS.actorValue) ?? max);
  const value = Math.max(0, Math.min(max, Number.isFinite(rawValue) ? rawValue : max));
  return { value, max };
}

async function updateActorPool(actor, update = {}) {
  const current = getActorPool(actor);
  const max = Math.max(1, Number(update.max ?? current.max) || 1);
  const value = Math.max(0, Math.min(max, Number(update.value ?? current.value) || 0));

  return actor.update({
    [`flags.${MODULE_ID}.${FLAGS.actorMax}`]: max,
    [`flags.${MODULE_ID}.${FLAGS.actorValue}`]: value,
  });
}

async function toggleActorTrait(actor) {
  const enabled = hasBossReactionPool(actor);
  await setTrait(actor, ACTOR_TRAIT, !enabled);
  if (!enabled) {
    const pool = getActorPool(actor);
    await updateActorPool(actor, { value: pool.max });
    ui.notifications?.info(localize("ActorTraitAdded", { actor: actor.name }));
  } else {
    ui.notifications?.info(localize("ActorTraitRemoved", { actor: actor.name }));
  }
  actor.sheet?.render?.(true);
}

async function toggleItemTrait(item, enabled) {
  await setTrait(item, ITEM_TRAIT, enabled);
  await item.update({ [`flags.${MODULE_ID}.-=${FLAGS.legacyItemElite}`]: null });
  ui.notifications?.info(enabled ? localize("Marked") : localize("Unmarked"));
  item.sheet?.render?.(true);
}

function addToConfigBucket(bucket, slug, label) {
  if (!bucket) return;
  if (bucket instanceof Map) {
    bucket.set(slug, label);
    return;
  }
  if (typeof bucket === "object") bucket[slug] = label;
}

function registerPF2eTraits() {
  if (!isPF2e()) return;
  const config = CONFIG.PF2E;
  if (!config) return;

  // PF2e trait bucket names have shifted over time. Add this module's slugs to
  // every likely bucket; missing buckets are ignored.
  for (const key of [
    "actorTraits",
    "creatureTraits",
    "npcTraits",
    "ancestryTraits",
  ]) {
    addToConfigBucket(config[key], ACTOR_TRAIT, localize("ActorTraitLabel"));
  }

  for (const key of [
    "actionTraits",
    "featTraits",
    "itemTraits",
    "abilityTraits",
    "traits",
  ]) {
    addToConfigBucket(config[key], ITEM_TRAIT, localize("ItemTraitLabel"));
  }
}

function findActionsHeader(root) {
  const localized = game.i18n.localize("PF2E.ActionActionsLabel");
  const textOptions = [localized, "Actions", "Offense", "Abilities"].filter(Boolean);
  const candidates = [...root.querySelectorAll("h1,h2,h3,h4,header,.section-header,.item-list-header,.action-header")];
  return candidates.find((el) => textOptions.some((text) => el.textContent?.trim().includes(text))) ?? null;
}

function findPanelAnchor(root) {
  return findActionsHeader(root)
    ?? root.querySelector('[data-tab="actions"]')
    ?? root.querySelector('[data-tab="main"]')
    ?? root.querySelector(".sheet-body")
    ?? root;
}

async function spendBossReaction(actor, item = null) {
  if (!hasBossReactionPool(actor)) {
    ui.notifications?.warn(localize("Disabled", { actor: actor.name }));
    return;
  }

  const pool = getActorPool(actor);
  if (pool.value <= 0) {
    ui.notifications?.warn(localize("Empty", { actor: actor.name }));
    return;
  }

  const remaining = pool.value - 1;
  await updateActorPool(actor, { value: remaining });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="pf2e chat-card pf2e-boss-reactions-chat"><strong>${escapeHTML(localize("BossReaction"))}:</strong> ${localize("Spent", {
      actor: escapeHTML(actor.name),
      item: escapeHTML(item?.name ?? localize("BossReaction")),
      remaining,
      max: pool.max,
    })}</div>`,
  });
}

function buildNPCPanel(actor, editable) {
  const pool = getActorPool(actor);
  const wrapper = document.createElement("section");
  wrapper.className = "pf2e-boss-reactions-panel";
  wrapper.dataset.bossReactionsPanel = "true";

  wrapper.innerHTML = `
    <div class="br-title-row">
      <div class="br-title-label">
        <img class="pf2e-br-icon" src="${ICON_PATH}" alt="">
        <strong>${escapeHTML(localize("BossReactions"))}</strong>
        <span class="br-trait-pill">${ACTOR_TRAIT}</span>
      </div>
      <div class="br-title-actions">
        <button type="button" data-br-action="spend" title="${escapeHTML(localize("SpendGeneric"))}" ${editable ? "" : "disabled"}>
          <i class="fa-solid fa-bolt"></i> ${escapeHTML(localize("SpendGeneric"))}
        </button>
        <button type="button" data-br-action="reset" title="${escapeHTML(localize("Reset"))}" ${editable ? "" : "disabled"}>
          <i class="fa-solid fa-rotate-right"></i>
        </button>
      </div>
    </div>
    <div class="br-tracker">
      <button type="button" data-br-action="minus" ${editable ? "" : "disabled"}>−</button>
      <input type="number" min="0" data-br-field="value" value="${pool.value}" ${editable ? "" : "disabled"}>
      <span>/</span>
      <input type="number" min="1" data-br-field="max" value="${pool.max}" ${editable ? "" : "disabled"}>
      <button type="button" data-br-action="plus" ${editable ? "" : "disabled"}>+</button>
    </div>
    <p class="br-hint">${escapeHTML(localize("TrackerHint"))}</p>
  `;

  wrapper.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-br-action]");
    if (!button || !editable) return;

    event.preventDefault();
    event.stopPropagation();

    const action = button.dataset.brAction;
    const current = getActorPool(actor);

    if (action === "minus") {
      await updateActorPool(actor, { value: current.value - 1 });
    } else if (action === "plus") {
      await updateActorPool(actor, { value: current.value + 1 });
    } else if (action === "reset") {
      await updateActorPool(actor, { value: current.max });
    } else if (action === "spend") {
      await spendBossReaction(actor);
    }
    actor.sheet?.render?.(true);
  });

  wrapper.addEventListener("change", async (event) => {
    if (!editable) return;
    const target = event.target;
    const current = getActorPool(actor);

    if (target.matches?.('[data-br-field="value"]')) {
      await updateActorPool(actor, { value: Number(target.value) });
      actor.sheet?.render?.(true);
    } else if (target.matches?.('[data-br-field="max"]')) {
      const max = Math.max(1, Number(target.value) || 3);
      await updateActorPool(actor, { max, value: Math.min(current.value, max) });
      actor.sheet?.render?.(true);
    }
  });

  return wrapper;
}

function patchBossReactionActionRows(actor, root, editable) {
  if (!hasBossReactionPool(actor)) return;

  const bossItems = actor.items.filter(isBossReactionItem);
  for (const item of bossItems) {
    const selectors = [
      `[data-item-id="${CSS.escape(item.id)}"]`,
      `[data-item-id="${CSS.escape(item._id ?? item.id)}"]`,
      `[data-item-uuid="${CSS.escape(item.uuid ?? "")}"]`,
    ].filter((selector) => !selector.includes('""'));

    const row = selectors.map((selector) => root.querySelector(selector)).find(Boolean);
    if (!row || row.dataset.bossReactionsRowPatched === "true") continue;

    row.dataset.bossReactionsRowPatched = "true";
    row.classList.add("pf2e-boss-reaction-item");

    const title = row.querySelector("h4, .item-name, .name, .action-name, [data-tooltip]") ?? row.firstElementChild ?? row;
    const badge = document.createElement("span");
    badge.className = "pf2e-br-badge";
    badge.innerHTML = `<img src="${ICON_PATH}" alt=""> <span>${escapeHTML(localize("BossReaction"))}</span>`;
    title.append(badge);

    if (editable) {
      const use = document.createElement("button");
      use.type = "button";
      use.className = "pf2e-br-use";
      use.dataset.brUse = item.id;
      use.innerHTML = `<img src="${ICON_PATH}" alt=""> <span>${escapeHTML(localize("Use"))}</span>`;
      use.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        spendBossReaction(actor, item);
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

  // New behavior: nothing is inserted into normal monster sheets. The tracker
  // only appears if the NPC has the boss-reactions trait.
  if (hasBossReactionPool(actor) && !root.querySelector('[data-boss-reactions-panel="true"]')) {
    const panel = buildNPCPanel(actor, editable);
    const anchor = findPanelAnchor(root);

    if (anchor === root || anchor.matches?.('[data-tab="actions"], [data-tab="main"], .sheet-body')) {
      anchor.prepend(panel);
    } else {
      anchor.insertAdjacentElement("afterend", panel);
    }
  }

  patchBossReactionActionRows(actor, root, editable);
}

function patchItemSheet(app, html) {
  const root = toHTMLElement(html);
  const item = getAppItem(app);
  if (!root || !isSupportedItem(item)) return;
  if (root.querySelector('[data-boss-reaction-item-toggle="true"]')) return;

  const editable = userCanEdit(app, item);
  const checked = isBossReactionItem(item);
  const wrapper = document.createElement("div");
  wrapper.className = "pf2e-br-item-toggle";
  wrapper.dataset.bossReactionItemToggle = "true";
  wrapper.innerHTML = `
    <label>
      <input type="checkbox" ${checked ? "checked" : ""} ${editable ? "" : "disabled"}>
      <img class="pf2e-br-icon" src="${ICON_PATH}" alt="">
      <strong>${escapeHTML(localize("MarkAbility"))}</strong>
    </label>
    <p>${escapeHTML(localize("MarkAbilityHint"))}</p>
  `;

  wrapper.querySelector("input")?.addEventListener("change", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await toggleItemTrait(item, event.currentTarget.checked);
  });

  const actionType = root.querySelector('select[name="system.actionType.value"]');
  const anchor = actionType?.closest(".form-group, .form-row, label")
    ?? root.querySelector('[name="system.traits.value"]')?.closest(".form-group, .form-row, label")
    ?? root.querySelector(".sheet-body")
    ?? root;

  if (anchor === root || anchor.matches?.(".sheet-body")) anchor.prepend(wrapper);
  else anchor.insertAdjacentElement("afterend", wrapper);
}

function addActorHeaderButtonV1(app, buttons) {
  const actor = getAppActor(app);
  if (!isPF2e() || !isNPCActor(actor) || !game.user?.isGM) return;
  if (buttons.some((button) => button.class === "pf2e-br-header-toggle")) return;

  const hasTraitNow = hasBossReactionPool(actor);
  buttons.unshift({
    label: hasTraitNow ? localize("RemoveTrait") : localize("AddTrait"),
    class: "pf2e-br-header-toggle",
    icon: hasTraitNow ? "fas fa-bolt" : "far fa-bolt",
    onclick: () => toggleActorTrait(actor),
  });
}

function addActorHeaderButtonV2(app, controls) {
  const actor = getAppActor(app);
  if (!isPF2e() || !isNPCActor(actor) || !game.user?.isGM) return;
  if (controls.some((control) => control.action === "pf2e-br-toggle-trait")) return;

  const hasTraitNow = hasBossReactionPool(actor);
  controls.unshift({
    action: "pf2e-br-toggle-trait",
    label: hasTraitNow ? localize("RemoveTrait") : localize("AddTrait"),
    icon: hasTraitNow ? "fa-solid fa-bolt" : "fa-regular fa-bolt",
    onClick: () => toggleActorTrait(actor),
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
  console.log(`${MODULE_ID} | Initializing Boss Reactions`);
  registerPF2eTraits();
});

Hooks.once("ready", () => {
  registerPF2eTraits();
  game.modules.get(MODULE_ID).api = {
    actorTrait: ACTOR_TRAIT,
    itemTrait: ITEM_TRAIT,
    hasBossReactionPool,
    spendBossReaction,
    resetBossReactions: async (actor) => updateActorPool(actor, { value: getActorPool(actor).max }),
    addBossReactionsTrait: async (actor) => setTrait(actor, ACTOR_TRAIT, true),
    removeBossReactionsTrait: async (actor) => setTrait(actor, ACTOR_TRAIT, false),
  };
});

Hooks.on("renderActorSheet", (app, html) => {
  if (!isPF2e()) return;
  patchNPCSheet(app, html);
});

Hooks.on("renderItemSheet", (app, html) => {
  if (!isPF2e()) return;
  patchItemSheet(app, html);
});

Hooks.on("renderApplicationV2", (app, html) => {
  if (!isPF2e()) return;
  patchByDocument(app, html);
});

Hooks.on("getApplicationV1HeaderButtons", addActorHeaderButtonV1);
Hooks.on("getHeaderControlsApplicationV2", addActorHeaderButtonV2);

// PF2e class-specific fallbacks for sheet-class changes.
Hooks.on("renderNPCSheetPF2e", (app, html) => {
  if (!isPF2e()) return;
  patchNPCSheet(app, html);
});

Hooks.on("renderActionSheetPF2e", (app, html) => {
  if (!isPF2e()) return;
  patchItemSheet(app, html);
});

Hooks.on("renderAbilitySheetPF2e", (app, html) => {
  if (!isPF2e()) return;
  patchItemSheet(app, html);
});

Hooks.on("renderFeatSheetPF2e", (app, html) => {
  if (!isPF2e()) return;
  patchItemSheet(app, html);
});
