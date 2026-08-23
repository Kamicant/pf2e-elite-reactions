# PF2e Boss Reactions

Replacement update for the old Elite Reactions module.

The module folder/id is still `pf2e-elite-reactions` so it can replace the old version cleanly, but the visible mechanic is now called **Boss Reactions** to avoid colliding with PF2e's existing **Elite** adjustment/wording.

## New trait-based behavior

### NPC trait

Add this trait to an NPC:

```text
boss-reactions
```

When an NPC has that trait, the Boss Reactions tracker appears automatically on the NPC sheet. If the trait is removed, the tracker disappears.

The GM sheet header also gets a quick button to add/remove the trait, but the trait itself is the important part.

### Ability/item trait

Add this trait to an NPC ability/action you want to spend from the pool:

```text
boss-reaction
```

Those abilities receive a Boss Reaction badge and a **Use Boss Reaction** button while the owning NPC has the `boss-reactions` trait.

The module also adds a small checkbox to action/feat item sheets called **Boss Reaction ability**, which toggles the `boss-reaction` trait for you.

## Why this update exists

The old module tried to add a fake action type named Elite Reaction. PF2e only expects its real action types, so that approach was fragile in Foundry v14. This version stores everything as normal PF2e data plus traits, which should be much safer.

## Usage

1. Add `boss-reactions` to the monster/NPC traits.
2. Set the pool to 3/3 or whatever you want.
3. Add `boss-reaction` to special abilities that use the pool, or use the checkbox on the ability sheet.
4. Click **Use Boss Reaction** on the ability, or use the generic **Spend Boss Reaction** button in the tracker.
