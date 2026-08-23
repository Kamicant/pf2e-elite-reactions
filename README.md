# PF2e Elite Reactions

Adds an **Elite Reaction** action-type option to PF2e action/feat item sheets and an NPC tracker for extra reaction uses.

## V0.2.0 changes

- Updated the manifest for Foundry VTT v14.
- Added ApplicationV2 render/header hooks while keeping older fallback hooks.
- NPC sheets now stay clean when Elite Reactions are turned off.
- A GM header button on NPC sheets enables or disables the Elite Reactions tracker.
- Marked Elite Reaction abilities only get their badge/use button while the NPC's Elite Reactions pool is enabled.

## Usage

1. Open an NPC sheet.
2. As GM, use the sheet header control labeled **Enable Elite Reactions**.
3. Set the tracker to 3/3 or whatever value you want.
4. Open an action/feat item and choose **Elite Reaction** in the action type dropdown.

The item is stored as a normal PF2e reaction plus a module flag, so it avoids invalid PF2e system data.
