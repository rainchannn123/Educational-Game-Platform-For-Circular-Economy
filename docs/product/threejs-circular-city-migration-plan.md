# Clash of the Cities- Mission Net Zero Three.js Stage: Implementation Status

## Current Status

The migration from a page-like dashboard to a full-window game stage is implemented. The active match is a fixed viewport city scene with accessible React controls overlaid on top. Three.js communicates the city’s state visually; it never authoritatively changes game state.

## Implemented Stage

```text
Fixed full viewport
  -> Three.js circular city background
  -> dark-green metric banner and role/countdown status
  -> project rail
  -> contextual role control panel
  -> City Signal chat and city ranking table
  -> shared inventory belt and action controls
```

The city includes Municipality, MRF, Broker, warehouse, and future-project facilities. It has a flat annular road, ambient traffic/pedestrians, transport effects, and cosmetic role avatars. Municipality, MRF, and Broker avatars support local keyboard movement and jumping; that cosmetic state is intentionally not synchronized and does not alter game results.

## Authoritative Visual Mapping

| Canonical state or event | Visual representation |
| --- | --- |
| `waste.spawned` | Incoming Municipality batch appears in the role panel and city context |
| Municipality collection | Route selection and an in-transit arrival countdown |
| `municipality.transport.updated` | Batch arrives at MRF decomposition work |
| MRF decomposition | Mixed batch becomes separate material streams in the MRF recycle tab |
| MRF processing completion | Recovered material enters shared/MRF inventory and city effects |
| Material transfer completion | Recipient role allocation updates and transfer visual completes |
| Project claim | Rail state, receipt, announcement, and city feedback update |
| Health recovery | Full-screen recovery overlay with server-timed countdown |

## Accessibility And Responsive Behavior

- Every game action is an ordinary semantic DOM control, not a canvas-only interaction.
- Facility selection is supplemented by role workspaces and action controls.
- The city scene has a fallback path when WebGL is unavailable.
- Pop-ups and HUD elements remain available on desktop and mobile layouts.
- Keyboard focus, hover/focus help, readable material colors, and reduced-motion support are maintained through React/CSS layers.

## Current Product Constraints

- The MRF workflow is Decompose, then Recycle, then Inventory. Mixed raw batches cannot be recycled directly.
- Only Municipality completes projects.
- Project requirements are checked against shared inventory.
- Browser animation cannot settle inventory, wallet, health, transport, or project state.

## Remaining Visual Polish

The current stage is functional and authoritative-data-driven. Future work may improve original low-poly asset variety, construction feedback, and additional accessibility testing, without changing the server-authoritative boundary.
