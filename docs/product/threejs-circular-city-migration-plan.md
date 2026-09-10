# Circular City Rush: Full-Window Three.js Game Stage Plan

## 1. Corrected Product Decision

The active match must not render a Three.js city inside a dashboard card. The active match is one fixed, full-window 3D game stage.

The scene fills the browser viewport and acts as the persistent shared world for all three members of a team. Match metrics, countdowns, projects, inventory, communication, and actions attach to the viewport as compact HUD elements and contextual pop-ups. Nothing is laid out as a conventional page below the Project Rail during active play.

```text
Full browser viewport
  -> fixed orthographic 3D circular city background
  -> attached match HUD at the top edge
  -> attached compact Project Rail below the HUD
  -> clickable city facilities and animated material routes
  -> contextual role action pop-up over the scene
  -> attached inventory and team-action shortcuts at the bottom edge
```

Next.js, React, Express, MongoDB, the worker, REST commands, Socket.IO, the durable outbox, and the current game engine remain in place. Three.js through React Three Fiber is the rendering layer, not a second source of game truth.

## 2. Experience Goal

The intended experience is a cute, energetic, original circular-economy coordination game. It should create the shared-workspace urgency and clarity associated with successful cooperative games while retaining a completely original city theme, art style, interface, terminology, characters, assets, sound, and layout.

The player should feel that they are operating one living miniature city with their teammates:

- Municipality activates collection points and sends waste vehicles toward the MRF.
- MRF sees arriving batches, starts sorting lines, and watches recovered materials fill shared silos.
- Broker works from the exchange hub, dispatches procurement vehicles, and sees trade cargo enter or leave the city.
- All roles see the same projects, City Care condition, material flow, teammate pings, and city outcomes.
- Every authoritative action produces an understandable visual response in the shared world.

The city must feel like a game world, not a data dashboard with a decorative canvas.

## 3. Non-Negotiable Layout

### 3.1 Full-window stage

During a live match, the active route uses a fixed viewport shell:

```css
position: fixed;
inset: 0;
width: 100vw;
height: 100dvh;
overflow: hidden;
```

The WebGL canvas is positioned absolutely behind the HUD and fills the entire stage. The city remains visible when action pop-ups open.

### 3.2 Attached HUD

The HUD consists of compact overlays rather than page sections:

| HUD element           | Placement          | Purpose                                                             |
| --------------------- | ------------------ | ------------------------------------------------------------------- |
| Match HUD             | Top edge           | Wallet, health, CO2, connection, role, phase, countdown             |
| Project Rail          | Below top HUD      | Horizontal list of preview, active, and queued projects             |
| Status toast          | Lower center       | Accepted commands, errors, reconnect state, educational feedback    |
| Inventory belt        | Bottom-left edge   | Compact A/B/C material totals and locked state                      |
| Action launcher       | Bottom-center edge | Role work, City Care/inventory, communication, history              |
| Scene controls        | Bottom-right edge  | Labels, quality, reduced effects, fallback view                     |
| Context action pop-up | Right or left edge | Current role action, mission, trade, project, or communication flow |

HUD panels use translucent civic-control styling, readable text, strong focus indicators, and a narrow visual footprint. The central city view must remain legible.

### 3.3 Removed dashboard layout

The following active-match layout is removed:

- Large role workstation block below the city.
- Large Team Operations card below the role workstation.
- Separate communication card in a lower page column.
- Project history block under the scene.
- Embedded Shared City Overview card, header, description, and internal status tiles.

Their capabilities remain, but they move into contextual viewport pop-ups and attached HUD controls.

## 4. Shared City World

### 4.1 Fixed camera

Use one orthographic camera with a deterministic position and target. Every client must explicitly point the camera at the city origin using `camera.lookAt(0, 0, 0)` after creation and resize. Relying on the default Three.js camera direction is prohibited because a positioned camera otherwise looks away from the city and can produce a blank scene.

Recommended starting camera:

```text
position: [0, 13, 14]
target: [0, 0, 0]
projection: orthographic
zoom: responsive to viewport size, clamped to safe minimum/maximum
```

No free orbit or pan is provided in active play. Optional zoom has two presets and a reset action.

### 4.2 Circular city layout

The city uses a circular material loop with facilities arranged around it:

```text
                     Civic Project District
                    /                      \
          City Care                          Broker Exchange
             |                                    |
      Municipality ---- circular road/rail ---- MRF Campus
```

The layout is identical for all teammates and stable across reconnects. Role-specific emphasis changes highlights, not geography.

### 4.3 Cute cartoon art direction

- Rounded miniature buildings with exaggerated silhouettes.
- Friendly civic vehicles, cargo carts, material bales, silos, trees, and project plots.
- Warm cream roofs and signs against teal, green, amber, blue, and coral facilities.
- Soft sunlight, baked-looking shading, restrained emissive accents, and gentle idle movement.
- No photorealism, industrial horror, pollution spectacle, or shame-driven health imagery.
- Completed projects make the city visibly nicer through parks, repair spaces, shade structures, reused furniture, and greenery.

All art must be original or properly licensed and recorded in an asset provenance manifest.

## 5. Interaction Model

### 5.1 Facility interaction

City facilities are selectable with pointer input, but selection only opens an accessible DOM pop-up. The canvas never submits a game command directly.

| Selected facility     | Result for authorized role                           | Result for other roles                                      |
| --------------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| Municipality district | Open collection action pop-up                        | Show shared incoming-flow status and a teammate ping option |
| MRF campus            | Open process/queue action pop-up                     | Show queue status and a teammate ping option                |
| Broker exchange       | Open procurement/trade pop-up                        | Show exchange status and a teammate ping option             |
| Civic project plot    | Focus matching Project Rail item and project details | Same shared project details                                 |
| City Care site        | Open the viewer's role-specific mission step         | Same role-specific mission flow                             |

Every facility has an equivalent keyboard-accessible launcher in the bottom action bar.

### 5.2 Contextual action pop-ups

Action flows appear in a modeless pop-up dock over the scene. The user can still see the city, Project Rail, and timers.

Pop-ups must:

- Use ordinary semantic HTML controls.
- Have a visible title, close action, and focus target.
- Show exact wallet, CO2, health, duration, material, and quality effects before confirmation.
- Preserve drafts across recoverable server errors and reconnects.
- Never hide the match countdown.
- Remain usable with keyboard and screen reader.
- Collapse into a bottom sheet on narrow screens.

### 5.3 Automatic action prompts

When new role work arrives, show a compact prompt and open the role pop-up only when it will not interrupt a pending confirmation:

- Municipality: a new waste source appears or an existing source nears expiry.
- MRF: a batch arrives in the MRF queue or a hold approaches automatic landfill.
- Broker: a new incoming trade arrives, a project has a material deficit, or delivery completes.
- Every role: a new City Care mission requires that role's step.

Automatic prompts are deduplicated by durable entity id. They may not repeatedly reopen after the player closes them.

## 6. Backend-to-Animation Mapping

The scene visualizes canonical state and durable semantic events. It does not simulate outcomes.

| Backend command/event                    | 3D result                                                  | Persistent DOM result                                     |
| ---------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| `waste.spawned`                          | Collection marker appears in Municipality district         | Source details and expiry in action pop-up                |
| Municipality collection command accepted | Vehicle starts along chosen route                          | Command receipt, cost, CO2, server ETA                    |
| `municipality.transport.updated: at_mrf` | Vehicle enters MRF receiving bay                           | Batch appears in MRF queue                                |
| MRF process command accepted             | Correct processing line activates                          | Mode, duration, expected/non-authoritative preview        |
| `mrf.processing.updated: completed`      | Recovered tokens enter silos; residue takes separate route | Exact output, grade, residue, wallet, CO2, health receipt |
| External purchase accepted               | Procurement cargo enters Broker gate                       | Exact purchase and CO2 receipt                            |
| Trade accepted/in transit                | Cargo travels on standard or low-carbon route              | Trade terms, source, mode, server ETA                     |
| `trade.delivery.updated: completed`      | Cargo reaches exchange and silos                           | Exact inventory update and trade receipt                  |
| `project.previewed`                      | Blueprint marker appears at a project plot                 | Compact preview card in Project Rail                      |
| `project.activated`                      | Plot gains timer beacon and active construction frame      | Active card, requirements, readiness, timer               |
| `project.claimed`                        | Winning project builds through short staged animation      | Winner and settlement receipt                             |
| `health-mission.created`                 | City Care site requests attention                          | Role-specific mission question                            |
| `health-mission.updated`                 | Environment improves or displays calm recovery state       | Health delta and educational explanation                  |
| `ping.created`                           | Context marker appears over attached facility/entity       | Text announcement in team communication feed              |

Client animation never causes state changes. A vehicle visually reaching its destination does not update inventory. Only the corresponding worker/API state transition does.

## 7. Shared Team Synchronization

All three clients derive the city from the same team snapshot and semantic event stream:

1. Load `GET /v1/games/:gameId/snapshot`.
2. Normalize it into a typed `CityRenderModel`.
3. Render facility state, vehicles, projects, inventory silos, and City Care from that model.
4. Receive a typed Socket.IO event.
5. Deduplicate it by `eventId`.
6. Start only a bounded visual effect compatible with the event.
7. Patch or invalidate TanStack Query state.
8. Reconcile against the next canonical snapshot.

The city state is team-shared; role pop-up state is local. Opening a menu does not open it for teammates. Submitted role actions and their resulting city changes are shared.

## 8. Frontend Architecture

### 8.1 Target component structure

```text
GameScreen
  FullWindowGameStage
    CitySceneBackdrop
      FixedCameraRig
      CircularCityWorld
      MunicipalityDistrict
      MrfCampus
      BrokerExchange
      CivicProjectDistrict
      CityCareSite
      MaterialTransitLayer
    AttachedMatchHud
    AttachedProjectRail
    CompactInventoryBelt
    ActionLauncher
    ContextActionPopup
      MunicipalityActions | MrfActions | BrokerActions
      TeamOperations
      Communication
      ProjectHistory
    StatusToast
    AccessibleCityDescription
```

### 8.2 State ownership

| State                                                              | Owner                                |
| ------------------------------------------------------------------ | ------------------------------------ |
| Wallet, health, CO2, inventory, projects, jobs, transports, trades | TanStack Query canonical snapshot    |
| Game mutations                                                     | Existing REST command hook           |
| Realtime notification                                              | Socket.IO typed event handler        |
| Facility visuals                                                   | Pure `CityRenderModel` adapter       |
| Open action pop-up and selected facility                           | Local UI state/Zustand               |
| Short animation effects                                            | Deduplicated transient effect queue  |
| Camera target and quality preference                               | Local visual preference state        |
| Timer display                                                      | Server-time-offset display hook only |

### 8.3 Scene reliability

- Dynamically import the canvas with SSR disabled.
- Add an error boundary around WebGL initialization.
- Explicitly set camera target after mount and viewport resize.
- Use a full-window CSS fallback map if WebGL is missing or lost.
- Listen for `webglcontextlost`, prevent default recovery teardown, and switch to fallback with a status message when restoration fails.
- Dispose temporary meshes/materials and bound all transient effects.
- Do not add Three.js bundles to non-game routes.

## 9. Role-Specific Full-Stage Flows

### 9.1 Municipality

1. A district marker and small attention bubble appear.
2. Selecting it opens the collection pop-up over the city.
3. Source mass, composition, contamination, expiry, and project relevance are shown.
4. Express, standard, and consolidated routes show cost, CO2, duration, and MRF capacity.
5. Confirmation submits the existing Municipality REST command.
6. On acceptance, the popup reduces to a route receipt while the vehicle animates.
7. All teammates see the vehicle and server ETA.

### 9.2 MRF

1. Arriving vehicle enters the MRF bay.
2. MRF receives a contextual queue prompt.
3. Selecting the batch opens rapid, balanced, quality, hold, and landfill choices.
4. The pop-up shows projected output, grade, residue, cost, CO2, health, and duration.
5. Server acceptance activates the corresponding visual processing line.
6. Completion event produces material and residue animation plus exact receipt.

### 9.3 Broker

1. Project demand is visible through Broker Exchange signals and Project Rail requirements.
2. Selecting the exchange opens procurement/trade tabs.
3. External purchase and trade forms remain semantic DOM forms.
4. Accepted movement is represented by cargo on the city route.
5. Only authorized trade terms are visible.
6. Delivery completes only on the worker event.

### 9.4 Projects and City Care

- Project cards remain in the attached top rail.
- Selecting a project plot focuses its card and opens details when needed.
- Municipality's final claim uses an explicit confirmation pop-up.
- City Care is a facility in the world; selecting it opens only the viewer's role step.
- Health affects greenery, lighting, and operational cues without causing flashing or distressing destruction.

## 10. HUD and Visual Design

The HUD should feel attached to the game window rather than stacked as web cards:

- Use translucent dark glass with warm cream text.
- Use rounded, toy-like frames and short labels.
- Keep metrics in compact chips with icons.
- Let active projects use amber light and claimed projects use green completion state.
- Keep the central 55-65% of the viewport visually open.
- Use texture, pattern, icon, and label in addition to color.
- Keep all text readable against every city lighting state.

No HUD element may depend on hover for critical information.

## 11. Accessibility

The full-window design remains fully operable without using the canvas:

- Bottom action launcher exposes every facility and action.
- Project Rail is semantic HTML and keyboard scrollable.
- Pop-ups have correct headings, focus placement, close action, and disabled reasons.
- A screen-reader-only live city description summarizes transport, queue, processing, project, trade, and health changes.
- Reduced motion freezes vehicles at representative route positions and replaces construction sequences with immediate state changes.
- A full-window CSS fallback preserves spatial orientation when WebGL is unsupported.
- Mobile uses the same stage with action pop-ups converted to bottom sheets.

## 12. Performance Budget

| Metric                                      |                    Initial target |
| ------------------------------------------- | --------------------------------: |
| First scene asset payload                   |             under 8 MB compressed |
| Draw calls                                  |                 under 150 typical |
| Triangles                                   |       under 250k standard quality |
| Classroom laptop frame rate                 |     45 FPS minimum, 60 FPS target |
| Pixel ratio                                 |   capped at 1.5 standard, 1.0 low |
| Full-match memory growth                    | bounded with no effect/asset leak |
| Scene impact on REST command responsiveness |                              none |

Repeated trees, road parts, rails, cargo, and tokens use instancing. Prefer authored low-poly GLB assets and procedural primitives over many separate high-resolution assets.

## 13. Implementation Sequence

### Phase 1: Correct the stage shell

- Convert live game route to fixed viewport.
- Move canvas to full-window background.
- Explicitly point orthographic camera at city origin.
- Move header and Project Rail to attached HUD overlays.
- Remove all lower-page dashboard blocks.

### Phase 2: Context action system

- Add modeless action pop-up state.
- Move Municipality, MRF, Broker, Team Operations, communication, and project history into pop-ups.
- Add bottom action launcher and inventory belt.
- Connect scene facility selection to the correct pop-up.

### Phase 3: Role animation fidelity

- Add district source markers and route-specific vehicles.
- Add MRF arrival, conveyor, grade, material silo, and residue animations.
- Add Broker procurement and trade cargo routes.
- Add project construction and City Care environment transitions.

### Phase 4: Typed event effects and teammate presence

- Replace generic event payloads with discriminated contracts.
- Add deduplicated scene effect queue.
- Add teammate role/presence markers and contextual pings without exposing private state.
- Reconcile every effect after reconnect or revision gap.

### Phase 5: Final art and classroom hardening

- Replace primitives with original cartoon asset kit.
- Add original sound, captions, and preferences.
- Profile integrated-GPU classroom devices.
- Run keyboard, screen reader, reduced-motion, WebGL-loss, reconnect, and load tests.
- Pilot with students and instructors before default rollout.

## 14. Acceptance Criteria

- [ ] Active gameplay is one fixed full-window city stage with no page content below it.
- [ ] The 3D city is visibly rendered because the orthographic camera explicitly targets the city origin.
- [ ] Metrics, countdown, Project Rail, inventory, and launchers attach to viewport edges.
- [ ] Role work appears in contextual pop-ups over the scene.
- [ ] Selecting facilities opens accessible DOM actions and never bypasses REST authorization.
- [ ] Collection, MRF processing, trade, procurement, projects, and City Care have canonical event-driven animations.
- [ ] All three teammates see the same team city and authoritative outcomes.
- [ ] No scene frame, timer, or animation settles game state.
- [ ] Keyboard, reduced-motion, non-WebGL, mobile, and screen-reader paths retain complete gameplay.
- [ ] Art and interaction are original and communicate circular-economy learning clearly.

## 15. Final Directive

Treat the city as the game, not as a widget inside the game. The browser viewport is the shared circular-economy world. React DOM provides compact, accessible controls attached to that world; Three.js provides the persistent spatial view and event-driven feedback; the existing backend remains the sole authority for every action and outcome.
