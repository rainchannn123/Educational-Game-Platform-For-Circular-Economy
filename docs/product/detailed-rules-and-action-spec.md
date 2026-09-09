# Circular City Rush: Detailed Rules, Content, Action, UX, and Contract Specification

## 1. Status, Scope, and Precedence

This document converts `NEW_CIRCULAR_CITY_GAME_PLATFORM_IMPLEMENTATION_PLAN.md` into deterministic version-1 implementation rules.

It is the build specification for the new game. An implementation agent must not invent alternative defaults for any rule addressed here. If an implementation constraint conflicts with this specification, preserve the game invariant and record an architecture decision rather than silently changing a game rule.

### 1.1 Scope

This document specifies:

- game timing, units, constants, formulas, and ranking;
- project rail behavior and 20-second project cadence;
- Municipality, MRF, Broker, health-mission, trading, chat, chatbot, and facilitator actions;
- valid state transitions, preconditions, side effects, error behavior, auditing, and realtime publication;
- material, waste-source, project, and health-mission content;
- API request/response shapes and Socket.IO event payloads;
- required UX states, animations, and accessibility behavior;
- implementation acceptance tests.

### 1.2 Explicit version-1 constraints

- Exactly three students play each team: Municipality, MRF, and Broker.
- A match requires at least two complete teams. The default maximum is 30 teams.
- The ranking metric is final wallet balance, descending.
- Projects are universal: every active team sees the same project card at the same server time.
- Auction/bidding is not implemented.
- Broker trading and external wholesaler procurement are implemented.
- Client applications never settle a command, timer, trade, project, or metric locally.
- Gameplay uses lightweight dashboard/SVG/CSS animation. It is not a 3D physics or frame-synchronized game.

### 1.3 Authority order

When documents differ, use this order:

1. This detailed rules/action specification for version-1 numerical and behavioral rules.
2. `NEW_CIRCULAR_CITY_GAME_PLATFORM_IMPLEMENTATION_PLAN.md` for architecture, module boundaries, operational requirements, and rationale.
3. `CURRENT_GAME_LOGIC_MIGRATION_BRIEF.md` only for legacy reference/content reuse.
4. Existing Besse code only for reusable infrastructure patterns, not game-rule authority.

## 2. Canonical Data and Numeric Conventions

### 2.1 Internal units

All authoritative calculations use integers. Do not use JavaScript floating-point arithmetic for money, material mass, or CO2 settlement.

| Domain | Internal unit | UI display |
|---|---|---|
| Wallet, cost, revenue | integer cents | `$12,345` or `$12,345.00` |
| Material mass | integer kilograms | tonnes with one decimal: `2.5 t` |
| CO2 | integer kilograms CO2e | tonnes with one decimal: `4.2 tCO2e` |
| Health | integer points from 0 to 100 | whole-number percentage |
| Time | UTC epoch milliseconds | localized countdown/time format |
| Revisions | non-negative integer | not normally exposed except diagnostics |

Conversions:

```text
1 tonne = 1,000 kg
1 displayed tCO2e = 1,000 CO2 kg
1 displayed dollar = 100 cents
```

Rounding rules:

- Monetary multiplication rounds half up to the nearest cent.
- Material recovery floors to the nearest kilogram. No material is created through rounding.
- CO2 calculations round half up to the nearest kilogram.
- Wallet cannot become negative from a command; any command causing a negative wallet is rejected before settlement.
- Health is clamped to `[0, 100]` after every mutation.
- CO2 is clamped to a minimum of `0 kg` after a project carbon benefit is applied.

### 2.2 ID conventions

| Entity | Prefix | Example |
|---|---|---|
| Game | `game_` | `game_01J...` |
| Team | `team_` | `team_01J...` |
| Project | `proj_` | `proj_01J...` |
| Waste source | `waste_` | `waste_01J...` |
| Transport | `transport_` | `transport_01J...` |
| Processing job | `process_` | `process_01J...` |
| Trade offer | `trade_` | `trade_01J...` |
| Health mission | `health_` | `health_01J...` |
| Activity event | `evt_` | `evt_01J...` |
| Client command | UUID v4/v7 | `550e8400-e29b-...` |

### 2.3 Role identifiers

Use these exact lowercase values in persistence, API contracts, authorization, and events:

```text
municipality
mrf
broker
```

Display labels are `Municipality`, `MRF`, and `Broker`.

## 3. Match Configuration: Version 1 Default Scenario

### 3.1 `standard-urban-rush-v1` configuration

| Setting | Value | Rule |
|---|---:|---|
| Minimum teams | 2 | Game cannot start below this number |
| Maximum teams | 30 | Room-level configurable up to this hard limit |
| Team size | 3 | Exactly one selected player per role |
| Briefing duration | 45 seconds | Starts after facilitator starts game; no commands accepted except chat/pings/settings |
| Active duration | 600 seconds | 10-minute competitive phase |
| Finalization duration | 20 seconds | No new collection, processing, external purchase, or trade offers; active projects may still be claimed |
| Result duration | no limit | Facilitator controls transition away |
| Starting wallet | $12,000.00 | `1,200,000` cents per team |
| Starting health | 70 | Integer points |
| Starting CO2 | 0 tCO2e | `0 kg` |
| Active project cap | 4 | At most four `active` projects globally |
| Project announce interval | 20 seconds | First active project at active-phase second 0 |
| Project preview lead | 10 seconds | Next project is visible before announcement |
| Project active duration | 75 seconds | Unless individual template overrides this value |
| Final project announcement | active-phase second 540 | No new project at or after second 560 |
| Waste-source refresh interval | 15 seconds | Per team, server scheduled |
| Waste-source visible cap | 4 | New source only appears when under cap |
| Waste-source expiry | 55 seconds | Uncollected source expires with health penalty |
| MRF queue cap | 3 batches | New collection can be dispatched only if MRF queue plus in-transit count is below 3 |
| MRF concurrent process cap | 1 | One active process per team |
| Health mission interval | 60 seconds | First mission created at active-phase second 50 |
| Health mission deadline | 50 seconds | One unresolved mission maximum per team |
| External market stock | unlimited | Simplifies v1; price and CO2 preserve trade-off |
| Outgoing open trade cap | 2 | Per team |
| Incoming open trade cap | 2 | Per team |
| Trade offer expiry | 25 seconds | Server timestamp only |
| Standard trade arrival | 8 seconds | Material arrives after acceptance |
| Low-carbon trade arrival | 15 seconds | Material arrives after acceptance |
| Team chat message limit | 8 messages / 10 seconds | Per user, sliding window |
| Structured ping limit | 12 pings / 10 seconds | Per user, sliding window |
| Chatbot request limit | 5 prompts / minute | Per user |

### 3.2 Match timeline

```text
T -45 to T 0       briefing; player education and planning only
T 0                active phase begins; project sequence 1 is announced and active
T 10, 30, 50...    next project preview becomes visible
T 20, 40, 60...    project is announced; it becomes active or queued
T 50               first health mission is created for each team
T 110, 170...      later health mission opportunities; only if team has no unresolved mission
T 540              final project announcement allowed
T 560              new project announcements stop
T 600              active phase ends; finalization starts
T 620              finalization ends; results are calculated and game is completed
```

The scheduler must process missed timer points in chronological order if it wakes late. For example, if a worker is delayed from second 39 to second 61, it must announce the project due at second 40 before it creates any mission due at second 50 and before the project due at second 60.

## 4. Metrics and Economic Rules

### 4.1 Wallet

```text
walletCents = startingWalletCents
            + completedProjectNetRevenueCents
            + tradeCashReceivedCents
            - collectionCostCents
            - processingCostCents
            - disposalCostCents
            - externalPurchaseCostCents
            - tradeCashPaidCents
            - tradeServiceFeeCents
            - cityCareCostCents
```

Wallet is the primary ranking metric. Wallet mutations are written with a named ledger reason in every activity event.

### 4.2 CO2

```text
totalCO2Kg = transportCO2Kg
            + processingCO2Kg
            + landfillCO2Kg
            + externalProcurementCO2Kg
            + tradeLogisticsCO2Kg
            + projectConstructionCO2Kg
            - projectAvoidedCO2Kg
```

CO2 must not directly subtract wallet outside the project multiplier. It affects value through the multiplier and through player-visible strategic trade-offs.

### 4.3 Health

Health represents city service reliability, local environmental quality, and resident trust.

| Event | Health delta |
|---|---:|
| Complete city-care mission | +8 |
| City-care mission expires | -6 |
| Waste source expires uncollected | -4 |
| Landfill 0 to 1,999 kg | -1 |
| Landfill 2,000 to 3,999 kg | -2 |
| Landfill 4,000 to 5,999 kg | -3 |
| Landfill 6,000 kg or more | -4 |
| Correct high-impact city-care choice bonus | +2 additional, maximum mission total +10 |
| Incorrect city-care choice | Mission may still complete, but rewards +3 rather than +8 |

Health behavior:

| Health range | State | Effect |
|---|---|---|
| 51 to 100 | Stable | No gameplay restriction |
| 35 to 50 | Watch | Visible warning; no command restriction |
| 20 to 34 | Strained | Project claim requires an explicit team confirmation prompt; no numerical penalty |
| 10 to 19 | Critical | New project claims are disabled; city-care missions remain fully available |
| 0 to 9 | Emergency | New project claims disabled; external purchases and trades remain available only to enable recovery; facilitator receives alert |

Health does not eliminate a team by default. A team can recover from any state through city-care missions. An instructor can enable `hard-elimination` only in an advanced scenario, not in `standard-urban-rush-v1`.

### 4.4 Project revenue multiplier from CO2

At the moment immediately before a successful project claim transaction applies any project reward:

```text
eligibleTeams = teams with status active, strained, critical, or emergency
averageCO2Kg = floor(sum(eligibleTeams.totalCO2Kg) / eligibleTeams.count)
co2ComparisonBaseKg = max(averageCO2Kg, 1,000)
excessRatioBasisPoints = max(0, floor((winnerCO2Kg - co2ComparisonBaseKg) * 10,000 / co2ComparisonBaseKg))
penaltyBasisPoints = floor(excessRatioBasisPoints * 1,500 / 10,000)
co2RevenueMultiplierBasisPoints = clamp(10,000 - penaltyBasisPoints, 5,500, 10,000)
netRevenueCents = roundHalfUp(grossRevenueCents * co2RevenueMultiplierBasisPoints / 10,000)
```

Important rules:

- Use the CO2 state before applying the claimed project's `co2ImpactKg`.
- Teams at or below average receive 10,000 basis points (1.00), never a bonus over 1.00.
- The exact multiplier and every source input must be persisted in the project award receipt.
- Teams that have formally withdrawn are excluded from average CO2.
- A team in emergency state is included in average CO2 but cannot claim a project.

### 4.5 Ranking

At `finalizationEndsAt`, calculate one `GameResultTeam` row per non-withdrawn team.

Sort using this exact order:

1. `walletCents` descending.
2. `totalCO2Kg` ascending.
3. `health` descending.
4. `lastProjectClaimedAt` ascending, where `null` sorts after any timestamp.
5. `citySlot` ascending for deterministic final fallback.

The final rank is stored and never recalculated from mutable state after game completion.

## 5. Material, Waste, Collection, and Processing Constants

### 5.1 Material definitions

| Material | Key | External unit price | External CO2/kg | Base recovery rate | Balanced process CO2/kg | Project-use CO2/kg | Reference trade value/kg |
|---|---|---:|---:|---:|---:|---:|---:|
| Paper | `paper` | $360/t | 0.40 kg | 0.85 | 0.12 kg | 0.80 kg | $180/t |
| Plastic | `plastic` | $700/t | 0.70 kg | 0.80 | 0.18 kg | 2.50 kg | $350/t |
| Metal | `metal` | $1,200/t | 0.90 kg | 0.90 | 0.16 kg | 1.50 kg | $600/t |
| Glass | `glass` | $240/t | 0.30 kg | 0.75 | 0.12 kg | 0.60 kg | $120/t |
| Wood | `wood` | $200/t | 0.25 kg | 0.90 | 0.08 kg | 0.30 kg | $100/t |

Notes:

- `External unit price` is intentionally double the reference trade value, representing a dependable but costly fallback.
- External CO2 is a simplified procurement/logistics factor for the educational model.
- `Project-use CO2` is applied only when a project's `co2ImpactKg` requires it. The version-1 content table already includes a net project CO2 impact, so project-use CO2 exists for future scenario authoring and is not separately charged in standard project claims. Do not double count it.

### 5.2 Material quality

| Grade | Meaning | Yield/eligibility rule |
|---|---|---|
| A | High-quality, low-contamination recovered material | Produced only by quality processing under acceptable contamination; may satisfy advanced certification bonus |
| B | Standard usable recovered material | Default recovered output; satisfies all standard project requirements |
| C | Low-quality/limited-use material | Can be traded or used only where a project explicitly allows grade C |

Version 1 standard projects accept grades A or B. Grade C cannot be used in standard project claims but may be exchanged or appear in advanced content. This makes MRF quality decisions meaningful without complicating every initial project card.

### 5.3 Waste source templates

Every team receives a deterministic but seed-shuffled sequence. Each source card has a random mass selected from the specified integer range and a fixed composition.

| Template | Origin | Mass range | Paper | Plastic | Metal | Glass | Wood | Contamination | Educational cue |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| `residential-clean` | Residential | 4.0 to 5.5t | 50% | 25% | 0% | 25% | 0% | 5% | Source separation works |
| `residential-mixed` | Residential | 4.5 to 6.0t | 45% | 30% | 0% | 20% | 5% | 18% | Contamination harms recovery |
| `commercial-packaging` | Commercial | 4.0 to 6.5t | 40% | 40% | 20% | 0% | 0% | 10% | Packaging stream needs sorting |
| `industrial-offcuts` | Industrial | 4.5 to 7.0t | 0% | 25% | 45% | 0% | 30% | 8% | High-value metal/wood recovery |
| `construction-renovation` | Construction | 5.0 to 7.5t | 0% | 10% | 35% | 25% | 30% | 15% | Reuse/recovery versus landfill |
| `community-event` | Community | 3.5 to 5.0t | 55% | 25% | 0% | 20% | 0% | 12% | Event waste prevention and collection |

Mass generation rule:

```text
massKg = random integer from template.minKg through template.maxKg, inclusive
```

Composition calculation rule:

1. For every material except the final non-zero component, use `floor(massKg * percentage)`.
2. Allocate the remaining kilograms to the final non-zero component.
3. Sum of input material kilograms must equal source mass exactly.

### 5.4 Municipality collection routes

| Route | Command key | Duration | Cost/kg | CO2/kg | Use case |
|---|---|---:|---:|---:|---|
| Express | `express` | 6s | $0.070 | 0.36 kg | Win an urgent material race at high cost/emissions |
| Standard | `standard` | 10s | $0.045 | 0.18 kg | Balanced default choice |
| Consolidated | `consolidated` | 16s | $0.028 | 0.10 kg | Low-cost/low-carbon choice; requires planning |

Collection settlement:

```text
collectionCostCents = roundHalfUp(source.massKg * route.costCentsPerKg)
collectionCO2Kg = roundHalfUp(source.massKg * route.co2KgPerKg)
```

The wallet and CO2 cost are charged when dispatch begins. The source moves to `in_transit`, then arrives at the MRF queue after route duration.

### 5.5 MRF processing modes

| Mode | Key | Duration | Cost/kg | CO2/kg | Yield multiplier | Contamination tolerance | Grade outcome |
|---|---|---:|---:|---:|---:|---:|---|
| Rapid sort | `rapid` | 6s | $0.065 | 0.18 kg | 0.85 | 20% | B if source contamination <= 10%; otherwise C |
| Balanced sort | `balanced` | 10s | $0.050 | 0.12 kg | 1.00 | 15% | B if source contamination <= 15%; otherwise C |
| Quality sort | `quality` | 14s | $0.070 | 0.10 kg | 1.07 | 12% | A if source contamination <= 12%; otherwise B |
| Safe hold | `hold` | no processing | $0.000 | 0.00 kg | none | none | preserves batch for up to 30s; no output |
| Landfill fallback | `landfill` | 4s | $0.050 disposal/kg | 2.50 kg | none | none | no material output |

Normal processing formula for each material component:

```text
contaminationMultiplier = max(0.50, 1 - source.contaminationPercent)
recoveredKg = floor(
  inputMaterialKg
  * material.baseRecoveryRate
  * processMode.yieldMultiplier
  * contaminationMultiplier
)
```

Processing totals:

```text
processingCostCents = roundHalfUp(source.massKg * mode.costCentsPerKg)
processingCO2Kg = roundHalfUp(source.massKg * mode.co2KgPerKg)
residueKg = source.massKg - sum(recoveredKg for all materials)
```

Residue rule:

- For rapid, balanced, and quality processing, residue is automatically sent to landfill during completion.
- Residue landfill cost is `$0.050/kg`; residue landfill CO2 is `2.50 kg CO2e/kg`.
- Apply landfill health penalty based on total residue mass.
- The MRF may use `safe hold` for no more than 30 seconds from queue arrival. After 30 seconds, it must choose a process mode or landfill fallback. At 45 seconds, held waste automatically moves to landfill fallback and logs an avoidable-delay event.

### 5.6 External wholesaler

Only Broker can purchase external material. There is no quantity limit in version 1.

```text
externalPurchaseCostCents = requestedKg * material.externalPriceCentsPerKg
externalProcurementCO2Kg = roundHalfUp(requestedKg * material.externalCO2KgPerKg)
```

External purchases are immediate. They add grade-B inventory to the purchasing team's inventory after command commit. The activity event must label the source as `external` so the final debrief can compare recovery/trade/external dependency.

### 5.7 Landfill fallback

Municipality does not have a direct `reject waste` action in version 1. All collected material must arrive at MRF. A source that is ignored expires on the street; an MRF batch can use landfill fallback.

This keeps Municipality's main decision focused on collection priority and logistics while leaving recovery/disposal decisions with MRF.

## 6. Project Rail Rules and Content

### 6.1 Project card states and transitions

```text
scheduled -> announced -> active -> claimed
                       -> expired
                       -> cancelled
announced -> queued -> active
announced -> cancelled
queued -> cancelled
scheduled -> cancelled
```

Rules:

- A scheduled project becomes `announced` at preview time.
- It becomes `active` at announcement time if active count is less than 4; otherwise it becomes `queued`.
- A queued project activates in sequence order when an active slot becomes available.
- A project is `claimed` only after the project-claim transaction commits.
- A project expires at `expiresAt` only if still active.
- Claimed, expired, and cancelled states are terminal.

### 6.2 Project readiness rules

Each active project has one `ProjectTeamWork` record per team only after that team performs a readiness action or saves a plan.

Required readiness fields:

```text
municipalityReady: boolean
mrfReady: boolean
brokerReady: boolean
municipalityReadyByUserId: string | null
mrfReadyByUserId: string | null
brokerReadyByUserId: string | null
municipalityReadyAt: timestamp | null
mrfReadyAt: timestamp | null
brokerReadyAt: timestamp | null
plannedMaterialsKg: map<material, kg>
```

Readiness actions are deliberately light but valid only if the role has reviewed a meaningful shared state:

| Role | Must select | Validation |
|---|---|---|
| Municipality | `sitePlan`: `standard-delivery` or `low-carbon-delivery` | Project must be active; municipality may change while not claimed |
| MRF | `certification`: `grade-a-bundle` or `grade-b-bundle` | Team inventory must contain at least the planned material amounts in valid grades at command time |
| Broker | `procurementPlan`: `recovered-first`, `trade-supported`, or `external-supported` | Selected plan must match at least one current inventory source represented in team's material provenance counters |

Readiness is invalidated only when:

- project leaves active state;
- team voluntarily clears its project plan;
- planned material changes to a set no longer supported by inventory;
- a trade/other action reduces inventory below a planned certified requirement.

When invalidated, emit `project.readiness.updated` to that team with explicit reason. Do not silently clear readiness.

### 6.3 Project-claim eligibility

A project claim command is eligible only when all conditions are true:

```text
game.status is active or finalizing
project.status is active
serverNow <= project.expiresAt
team.status is not withdrawn
team.health >= 20
actor role is municipality
municipalityReady && mrfReady && brokerReady
available eligible inventory meets all material requirements
project has not previously been claimed
```

`available eligible inventory` includes only grade A and B material. It excludes material currently locked in outgoing open trade offers.

### 6.4 Project content library

All values use display tonnes and dollars. Content config stores kg, cents, and CO2 kg.

| ID | Project | Tier | Requirements | Gross revenue | CO2 impact | Active duration | Notes |
|---|---|---:|---|---:|---:|---:|---|
| P01 | Neighborhood Pocket Park | 1 | 2t wood, 1t paper | $3,200 | -1.2t | 75s | Introductory reuse/public-space project |
| P02 | School Recycling Corner | 1 | 2t paper, 1t plastic, 1t metal | $3,800 | -1.0t | 75s | Demonstrates school sorting infrastructure |
| P03 | Community Repair Kiosk | 1 | 2t wood, 1t metal, 1t glass | $4,100 | -1.4t | 75s | Repair/reuse circularity |
| P04 | Eco Bus Stop Shelter | 2 | 3t metal, 2t paper, 1t plastic | $5,600 | -1.8t | 75s | High value metal demand |
| P05 | Refill Station Network | 2 | 2t plastic, 2t metal, 2t glass | $5,900 | -2.0t | 80s | Prevents single-use packaging |
| P06 | Riverbank Sorting Pier | 2 | 3t wood, 2t metal, 2t plastic | $6,100 | -1.5t | 80s | Recovery infrastructure |
| P07 | Public Library Furniture Renewal | 2 | 3t wood, 2t paper, 1t metal | $5,400 | -1.1t | 75s | Reuse/refurbishment theme |
| P08 | Smart Waste Bin Network | 3 | 3t plastic, 3t metal, 2t glass, 1t paper | $7,500 | -2.2t | 90s | Requires diverse material pipeline |
| P09 | Circular Market Pavilion | 3 | 3t wood, 3t metal, 2t glass, 2t paper | $7,800 | -2.5t | 90s | Supports local secondary-material market |
| P10 | Green Civic Plaza | 3 | 4t glass, 3t metal, 2t wood | $7,100 | -1.7t | 85s | Glass/logistics trade-off |
| P11 | Low-Carbon Housing Retrofit | 3 | 4t wood, 3t metal, 2t plastic, 1t glass | $8,600 | -2.0t | 90s | Construction reuse and material selection |
| P12 | Materials Innovation Lab | 4 | 4t paper, 4t plastic, 3t metal, 2t glass, 2t wood | $10,200 | -3.0t | 100s | Broad material demand, high reward |
| P13 | Industrial Reuse Depot | 4 | 5t metal, 4t wood, 3t plastic, 2t glass | $10,800 | -2.8t | 100s | Industrial material recirculation |
| P14 | Resilient Eco-School | 4 | 4t wood, 3t glass, 3t paper, 3t metal | $9,600 | -2.4t | 95s | Education/public-service theme |
| P15 | Solar Street Canopy | 4 | 5t metal, 4t plastic, 2t wood | $9,900 | +0.5t | 95s | Revenue with positive construction CO2 trade-off |
| P16 | Urban Reuse Hub | 5 | 5t metal, 4t paper, 4t plastic, 3t wood, 2t glass | $12,500 | -3.6t | 110s | Large multi-material project |
| P17 | Circular Trade Hall | 5 | 5t glass, 5t wood, 4t paper, 4t plastic, 5t metal | $14,000 | -4.0t | 115s | High-end capstone project |
| P18 | Citywide Compost Learning Center | 3 | 3t wood, 3t glass, 2t paper, 1t metal | $7,200 | -2.1t | 85s | Optional organics-learning context without adding organics inventory |
| P19 | Flood-Resilient Recovery Station | 5 | 5t metal, 4t plastic, 4t wood, 3t glass | $13,200 | -3.2t | 110s | Resilience/circular recovery infrastructure |
| P20 | Community Tool Library | 2 | 3t metal, 2t wood, 1t plastic | $5,200 | -1.6t | 80s | Product sharing and reuse |

### 6.5 Project schedule/deck selection

The scenario has a deck containing P01 through P20. The scheduler does not necessarily announce all templates in one 10-minute round.

Deterministic selection:

1. Project sequence 1 is P01 or P02, selected by seeded shuffle.
2. Sequences 2 through 6 use tier 1 or 2 projects.
3. Sequences 7 through 16 use tier 2 or 3 projects.
4. Sequences 17 through 25 use tier 3 or 4 projects.
5. Sequences after 25 use tier 4 or 5 projects only if active duration allows them to be reasonably completed.
6. Do not choose the same template twice in a standard match.
7. If deck capacity is exhausted, seed a new shuffled deck but do not repeat a template until every same-or-lower tier candidate has been used.

At most 28 projects can be announced in a standard match. In normal play, many projects will remain queued, expire, or be claimed; it is not an objective to complete every card.

## 7. City-Care Health Mission Content

### 7.1 Mission state machine

```text
scheduled -> active -> completed
                    -> expired
scheduled -> cancelled
active -> cancelled
```

Only one health mission can be `active` per team. Health-mission schedule slots occur at active-phase seconds 50, 110, 170, and so on. When a slot occurs while a mission is active, the scheduler skips that slot. Completing a mission early never creates a replacement before the next scheduled slot.

### 7.2 Mission completion

Each mission has one step for each role. Every step has two or three explicit options. A team receives:

- +8 health if all three selections are appropriate;
- +5 health if two selections are appropriate;
- +3 health if one or zero selections are appropriate;
- +2 additional health when all three selections are marked `highImpact`, capped at +10 total.

No mission selection changes wallet/CO2 unless the selected option explicitly lists a cost. The UI must show costs before selection.

### 7.3 Mission templates

| ID | Mission | Municipality appropriate option | MRF appropriate option | Broker appropriate option | Deadline | Explanation |
|---|---|---|---|---|---:|---|
| H01 | Source Separation Campaign | Target residential-mixed district | Publish clear material sorting guidance | Fund reusable signage and local education kit | 50s | Better source separation reduces contamination and improves recovery |
| H02 | Illegal Dumping Response | Dispatch documented collection and report route | Separate recoverable materials from hazardous residue | Approve compliant low-carbon contractor | 50s | Illegal dumping harms environmental quality and public trust |
| H03 | Repair and Reuse Pop-up | Allocate accessible community drop-off site | Identify repairable/reusable material stream | Fund repair partner and tool-share voucher | 50s | Repair and reuse retain products/material value longer |
| H04 | Overflowing Collection Zone | Prioritize consolidated collection route | Open balanced processing capacity | Approve route optimization support | 50s | Reliable collection prevents public-health/service failure |
| H05 | Recycling Quality Audit | Contact source generator with contamination feedback | Sample and certify contamination cause | Purchase only necessary quality-control supplies | 50s | Quality determines whether material can re-enter use |
| H06 | Public Procurement Check | Require recycled-content delivery plan | Confirm traceability and valid material grade | Reject unverified supplier and choose transparent source | 50s | Circular procurement includes traceability and standards |
| H07 | Reuse Exchange Day | Set up local exchange collection point | Route suitable materials to reuse before processing | Coordinate community partner and no-cost exchange ledger | 50s | Sharing and reuse can avoid waste generation |
| H08 | Construction Waste Prevention | Require source separation at renovation site | Isolate wood/metal/glass for recovery | Contract reusable-material collection service | 50s | Prevention and recovery reduce construction waste |

For every role step, content config includes `options`, one `appropriateOptionKey`, and one `highImpactOptionKey`. Incorrect options must be plausible but include a post-resolution explanation, not a shaming message.

## 8. Trading Specification

### 8.1 Trade terms

An offer contains:

```json
{
  "offered": {
    "materials": [{ "materialType": "paper", "grade": "B", "quantityKg": 2000 }],
    "cashCents": 0
  },
  "requested": {
    "materials": [{ "materialType": "metal", "minimumGrade": "B", "quantityKg": 1000 }],
    "cashCents": 0
  },
  "deliveryMode": "standard"
}
```

Rules:

- At least one offered material or offered cash value must be positive.
- At least one requested material or requested cash value must be positive.
- Material quantity is a positive multiple of 100 kg (0.1t) and at most 10,000 kg per material line.
- A trade cannot target the offering team.
- The recipient team must be active in the same game.
- Grade C can be traded; recipient must explicitly accept it.
- Creator may cancel an open offer before acceptance.
- Recipient may reject or counter an open offer.
- A counter creates a new offer with `parentTradeOfferId`; it does not modify original terms.

### 8.2 Fair-value guardrail

Reference value:

```text
materialReferenceValueCents = quantityKg * material.referenceTradeValueCentsPerKg
cashReferenceValueCents = cashCents
sideReferenceValue = materialReferenceValueCents + cashReferenceValueCents
```

The offer is valid only when:

```text
0.60 <= offeredSideReferenceValue / requestedSideReferenceValue <= 1.80
```

If requested side has zero reference value, reject with `TRADE_INVALID_ZERO_REQUEST_VALUE`. This disables pure gifts in standard competitive mode.

### 8.3 Resource locking and settlement

At offer creation:

- Verify offering team has sufficient unlocked materials and wallet.
- Add `lockedForTrade` quantity/cash to `GameTeamState`.
- Create `TradeOffer(status=open, expiresAt=now+25s)`.

At accept:

1. Start Mongo transaction.
2. Validate trade `status=open`, `expiresAt > now`, game active, recipient actor is target team's Broker, both teams active, and locks/inventories still valid.
3. Deduct offered material/cash from offering team and requested material/cash from recipient team.
4. Release locks.
5. Transfer cash immediately after applying a 5% service fee to the cash payer. The party paying a cash component pays the fee; fee is not transferred to another team.
6. Create `in-transit` material delivery records for both directions.
7. Apply logistics costs/CO2 to both teams based on delivery mode.
8. Mark offer `in-transit` with `deliveryDueAt`.
9. Write activity/outbox events.
10. Commit.

Trade delivery:

| Delivery mode | Duration | Service cost/team | CO2/team |
|---|---:|---:|---:|
| Standard | 8s | $40 | 350 kg CO2e |
| Low carbon | 15s | $25 | 150 kg CO2e |

At `deliveryDueAt`, the scheduler adds each incoming material line to recipient inventory and marks the trade `completed`.

### 8.4 Trade failure/expiry

- Expiry releases all offering-team locks and marks trade `expired`.
- Cancellation releases locks and marks `cancelled`.
- Reject releases locks and marks `rejected`.
- A game transition to finalization cancels all open offers and releases locks; in-transit trades complete normally.
- A team withdrawal cancels its open offers; in-transit material completes to the recipient but no new offers/acceptance are allowed.

## 9. Action Specification

## 9.1 Common command envelope

Every state-changing request has this envelope. `expectedTeamRevision` is required only for commands that directly mutate `GameTeamState`; concurrent project-readiness and health-step commands use entity-specific conditional fields instead.

```json
{
  "commandId": "550e8400-e29b-41d4-a716-446655440000",
  "expectedTeamRevision": 17,
  "payload": {}
}
```

Required headers:

```text
Authorization: Bearer <access token>
Idempotency-Key: <same command UUID or independent UUID>
Content-Type: application/json
```

Common success response:

```json
{
  "success": true,
  "data": {
    "commandId": "550e8400-e29b-41d4-a716-446655440000",
    "teamRevision": 18,
    "serverTime": "2026-09-09T10:05:00.000Z",
    "result": {}
  }
}
```

Common error response:

```json
{
  "success": false,
  "error": {
    "code": "PROJECT_ALREADY_CLAIMED",
    "message": "Another city has already completed this project.",
    "retryable": false,
    "snapshotRequired": true
  }
}
```

### 9.2 Standard command preconditions

Unless an action explicitly differs, every action must validate:

1. Valid authenticated user.
2. User is a selected member of the given team in the game.
3. User's selected role matches action authorization.
4. Game status accepts that action.
5. Team status accepts that action.
6. Command ID/idempotency key has not already produced a different result.
7. For commands mutating `GameTeamState`, expected team revision matches current team revision.
8. For concurrent work records, the action's own conditional state remains available, such as `roleStep.completed=false`; do not reject a teammate's simultaneous action merely because another role completed a different step.
9. Input schema is valid.

If an idempotency key has a prior successful command with identical method/path/body hash, return its original success result. If reused with a different hash, return `IDEMPOTENCY_KEY_REUSED`.

### 9.3 Municipality actions

#### A1. Dispatch waste collection

```text
POST /v1/games/:gameId/municipality/collections
Role: municipality
```

Payload:

```json
{
  "commandId": "uuid",
  "expectedTeamRevision": 17,
  "payload": {
    "wasteSourceId": "waste_123",
    "route": "standard"
  }
}
```

Additional preconditions:

- Waste source belongs to team and status is `available`.
- `serverNow < wasteSource.expiresAt`.
- `mrfQueueCount + inTransitCollectionCount < 3`.
- Team wallet can pay collection cost.

Atomic changes:

- Deduct collection cost from wallet.
- Add route CO2 to team total.
- Change waste source status to `in_transit`.
- Create transport record with due time.
- Increment team revision.
- Append activity event `municipality.collection_dispatched`.
- Add outbox events `municipality.transport.updated`, `team.metrics.updated` and `team.inventory.updated` only if inventory changes later.

Transport completion system action:

- At `arrivesAt`, change source to `at_mrf` and add it to MRF queue ordered by arrival time.
- Emit `municipality.transport.updated` and `mrf.queue.updated` to team.

Errors:

- `WASTE_SOURCE_NOT_FOUND`
- `WASTE_SOURCE_NOT_AVAILABLE`
- `WASTE_SOURCE_EXPIRED`
- `MRF_QUEUE_FULL`
- `INSUFFICIENT_WALLET`
- `STALE_TEAM_REVISION`

#### A2. Set Municipality project readiness

```text
POST /v1/games/:gameId/projects/:projectId/readiness/municipality
Role: municipality
```

Payload `sitePlan` is `standard-delivery` or `low-carbon-delivery`.

Effects:

- Upsert team work record using a conditional update on the Municipality readiness field, not `expectedTeamRevision`.
- Set Municipality readiness with actor/time/selection.
- No wallet/CO2 mutation in version 1.
- Emit `project.readiness.updated` to team.

#### A3. Save material plan

```text
PUT /v1/games/:gameId/projects/:projectId/material-plan
Roles: municipality, mrf, broker
```

Any team role may propose/edit plan. The plan is non-binding and does not reserve resources.

Payload:

```json
{
  "commandId": "uuid",
  "expectedWorkRevision": 3,
  "payload": {
    "materials": {
      "paper": 2000,
      "metal": 3000,
      "plastic": 1000,
      "glass": 0,
      "wood": 0
    }
  }
}
```

Validation:

- Keys are enabled material types only.
- Values are non-negative 100kg increments.
- Total plan must exactly match project requirements by material type.
- Project must be active or queued. Queued plans never allow readiness certification until project becomes active.

Effects:

- Update `plannedMaterialsKg` and plan author/time using `expectedWorkRevision`; return `STALE_PROJECT_WORK_REVISION` if another user changed the same plan first.
- Re-evaluate MRF/Broker readiness if inventory support changed.
- Emit team-private project work update.

#### A4. Claim completed project

```text
POST /v1/games/:gameId/projects/:projectId/claim
Role: municipality
```

Payload:

```json
{
  "commandId": "uuid",
  "expectedTeamRevision": 28,
  "payload": {
    "confirm": true
  }
}
```

Additional preconditions are the project-claim eligibility rules in section 6.3.

Atomic transaction changes:

1. Conditional project update from `active` to provisional claimed state; reject if another winner has already committed.
2. Read all eligible team CO2 values and calculate room average/multiplier.
3. Deduct project material requirements from winning team grade A/B inventory, consuming grade B before grade A unless project config says otherwise.
4. Add net revenue to wallet.
5. Apply project `co2ImpactKg` to winning team.
6. Set project winner, claim timestamp, reward receipt, and terminal `claimed` status.
7. Mark all `ProjectTeamWork` records for the project as `closed`; retain them for analytics but clear no inventory because plans were non-binding.
8. Increment winning team revision.
9. Write project claim and wallet/CO2 activity events/outbox events.

Events:

- Game-wide `project.claimed` with winner city/name, project title, gross/net reward, and carbon impact.
- Team-private `team.metrics.updated`, `team.inventory.updated`, and receipt event.
- Losing teams receive `project.plan.released` with a suggestion to review the next active project.

### 9.4 MRF actions

#### A5. Start MRF processing

```text
POST /v1/games/:gameId/mrf/processes
Role: mrf
```

Payload:

```json
{
  "commandId": "uuid",
  "expectedTeamRevision": 12,
  "payload": {
    "wasteSourceId": "waste_123",
    "mode": "balanced"
  }
}
```

Preconditions:

- Waste is in this team's MRF queue with status `at_mrf` or `held`.
- No other active MRF processing job exists for team.
- Mode is one of rapid, balanced, quality, hold, landfill.
- Team can pay immediate mode cost if processing or landfill cost.

Effects for rapid/balanced/quality:

- Deduct processing cost and processing CO2 immediately.
- Change waste status to `processing`.
- Create process job with due time and selected mode.
- Emit `mrf.processing.updated`.

Effects for `hold`:

- Change source state to `held`; store `holdExpiresAt = min(queueArrival + 45s, now + 30s)`.
- No financial effect.
- Emit queue update.

Effects for `landfill`:

- Deduct landfill cost and add landfill CO2 immediately.
- Apply health penalty based on full source mass.
- Change waste state to `landfilled` after 4 seconds via process job.

Processing completion system action:

- Calculate recovered material/residue using section 5.5.
- Add output to inventory with process-derived grade.
- Charge residue landfill cost and CO2.
- Apply residue health penalty.
- Mark source `processed`; job `completed`.
- Emit MRF output/inventory/team metric updates.

#### A6. Set MRF project readiness

```text
POST /v1/games/:gameId/projects/:projectId/readiness/mrf
Role: mrf
```

Payload `certification` is `grade-a-bundle` or `grade-b-bundle`.

Validation:

- Project must be active.
- Material plan must exist and exactly match project requirements.
- Current unlocked inventory must satisfy planned amounts with grades allowed by certification.
- `grade-a-bundle` requires every planned material to be grade A. Standard projects normally do not require this, so it is an optional quality signal.
- `grade-b-bundle` accepts grades A/B.

Effects: set MRF readiness through a conditional update on the MRF readiness field and emit team project-work update. It does not lock inventory or consume material.

### 9.5 Broker actions

#### A7. Buy from external wholesaler

```text
POST /v1/games/:gameId/broker/external-purchases
Role: broker
```

Payload:

```json
{
  "commandId": "uuid",
  "expectedTeamRevision": 11,
  "payload": {
    "materialType": "metal",
    "quantityKg": 1000
  }
}
```

Validation:

- `quantityKg` is 100kg to 10,000kg in 100kg increments.
- Game is active, not finalizing/completed.
- Wallet covers cost.

Effects:

- Deduct purchase cost.
- Add external procurement CO2.
- Add grade-B material marked source `external` to inventory.
- Increment provenance `externalPurchasedKg`.
- Re-evaluate project readiness records for inventory changes.
- Emit team metrics, inventory, and broker purchase events.

#### A8. Create trade offer

```text
POST /v1/games/:gameId/broker/trades
Role: broker
```

Use section 8 validation and locking rules. Response includes created offer, expiry, and team revision.

#### A9. Accept trade offer

```text
POST /v1/games/:gameId/broker/trades/:tradeOfferId/accept
Role: broker from recipient team
```

Payload includes only command envelope and selected delivery mode is fixed by original offer. Use section 8 settlement rules.

#### A10. Reject/cancel/counter trade offer

```text
POST /v1/games/:gameId/broker/trades/:tradeOfferId/reject
POST /v1/games/:gameId/broker/trades/:tradeOfferId/cancel
POST /v1/games/:gameId/broker/trades/:tradeOfferId/counter
```

- Only recipient Broker may reject/counter.
- Only creator Broker may cancel.
- Counter request contains full new offer terms and creates a distinct offer.
- Rejection/cancellation releases original locks exactly once.

#### A11. Set Broker project readiness

```text
POST /v1/games/:gameId/projects/:projectId/readiness/broker
Role: broker
```

Payload `procurementPlan` is one of:

```text
recovered-first
trade-supported
external-supported
```

Validation:

- Project active and exact material plan exists.
- Team's provenance counters show at least one material source compatible with selected plan.
- `recovered-first` requires at least 60% of planned mass in recovered material provenance.
- `trade-supported` requires at least 10% of planned mass received through completed trade.
- `external-supported` requires at least 10% of planned mass acquired externally.

This readiness selection is a transparent explanation of the team's actual procurement strategy, not an arbitrary button. Update it conditionally on the Broker readiness field rather than on `expectedTeamRevision`.

### 9.6 Health mission role-step action

```text
POST /v1/games/:gameId/health-missions/:missionId/steps
Roles: all, only for their own step
```

Payload:

```json
{
  "commandId": "uuid",
  "payload": {
    "optionKey": "target-residential-mixed"
  }
}
```

Validation:

- Mission belongs to team, status active, and deadline not reached.
- Actor role has not already submitted its own step. The update condition is that role's own incomplete step, so Municipality, MRF, and Broker can submit their three choices concurrently.
- Option key exists for that role/template.

Effects:

- Record role selection and selected option cost/CO2 if any without changing team revision.
- If all three steps are complete, calculate mission outcome and health delta immediately in a transaction that conditionally changes mission status from `active` to `completed`; only that successful transaction updates team health/revision.
- Emit `health-mission.updated`; if completed, emit `health.updated` and city-care result explanation.

### 9.7 Communication actions

#### A12. Structured ping

```text
POST /v1/games/:gameId/pings
Roles: all
```

Allowed ping types:

```text
need-material
batch-dispatched
material-ready
please-certify
project-ready
trade-offer
health-urgent
blocked
acknowledged
```

Payload can attach one project, material, waste source, health mission, or trade ID. It cannot contain arbitrary HTML/markdown.

#### A13. Team and trade chat

```text
POST /v1/games/:gameId/chat/messages
Roles: all
```

Channels:

- `team`: members of one team.
- `trade:<tradeOfferId>`: members of the two relevant teams; read-only for everyone else.
- `facilitator-announcement`: admin write, all-game read.

Messages:

- max 500 characters;
- plain text plus restricted Markdown subset rendered safely;
- rate limits from section 3;
- store separate chat record with retention policy; write activity metadata but not necessarily full content to general activity event log.

### 9.8 Chatbot action

```text
POST /v1/games/:gameId/chatbot/messages
Roles: all
```

Payload:

```json
{
  "message": "Should we wait for our MRF metal or trade for it?",
  "context": "broker"
}
```

Allowed context sent to chatbot:

- requesting team wallet, health, CO2 band, inventory summary, own active transport/process/trade summaries;
- current public active project cards;
- current team's own health mission;
- approved rule/content documentation.

Never send other teams' private inventories, private plans, raw private chat, credentials, or unapproved personal information.

## 10. System Actions and Scheduled Transitions

| System action | Trigger | Required effect |
|---|---|---|
| `project.preview` | `previewAt` | Change project to announced and broadcast game-wide preview |
| `project.announce` | `announcementAt` | Change to active/queued based on cap; broadcast card |
| `project.activate-next` | An active project closes | Activate oldest queued project; set `expiresAt = activationTime + template duration` |
| `project.expire` | active project `expiresAt` | Terminal expired state, close team work, broadcast game-wide |
| `waste.spawn` | team source refresh due | Create source if team visible count < 4 |
| `waste.expire` | available source expiry | Mark expired, health -4, audit/broadcast team |
| `collection.arrive` | transport `arrivesAt` | Move source into MRF queue |
| `processing.complete` | job due | Calculate recovery/residue, update inventory/metrics |
| `hold.auto-landfill` | held source `holdExpiresAt` | Trigger landfill fallback and log avoidable delay |
| `trade.expire` | offer expiry | Release locks, mark expired |
| `trade.deliver` | delivery due | Add incoming material, mark completed |
| `health.create` | health interval due and no active mission | Create seeded team-specific mission |
| `health.expire` | mission expiry | Health -6, mark expired |
| `game.finalize` | active ends | Cancel open offers, stop new procurement/processing/collection, retain active project claims |
| `game.complete` | finalization ends | Force expire any active projects, calculate/store rankings, mark completed |

All system actions must be idempotent and record an activity event with `actorType=system`.

## 11. Error Codes and User Messages

| Code | User-facing message | UI behavior |
|---|---|---|
| `STALE_TEAM_REVISION` | Your city state changed. Refreshing the latest game state. | Fetch snapshot and retain non-submitted draft where safe |
| `GAME_NOT_ACCEPTING_ACTIONS` | The match is not accepting this action right now. | Disable action and show game phase |
| `ROLE_NOT_AUTHORIZED` | This action belongs to the [role] workstation. | Highlight relevant role/hand-off |
| `INSUFFICIENT_WALLET` | Your city does not have enough wallet balance for this action. | Show required and available values |
| `MRF_QUEUE_FULL` | The MRF queue is full. Process or wait for an incoming batch first. | Highlight MRF queue state |
| `WASTE_SOURCE_EXPIRED` | This waste source has already expired. | Remove card and show health effect |
| `PROJECT_NOT_ACTIVE` | This project is not currently claimable. | Update rail card |
| `PROJECT_ALREADY_CLAIMED` | Another city has already completed this project. | Show winner, release plan, suggest next project |
| `PROJECT_REQUIREMENTS_NOT_MET` | Your team is still missing required material or role confirmation. | List exact missing items/roles |
| `HEALTH_TOO_LOW_TO_CLAIM` | City Health is too low to start another project. Complete City Care first. | Highlight health mission |
| `MATERIAL_LOCKED_FOR_TRADE` | Some material is locked in an active trade offer. | Link to trade offer |
| `TRADE_OFFER_EXPIRED` | This trade offer has expired. | Refresh trade inbox |
| `TRADE_NOT_RECIPIENT` | Only the receiving team's Broker can accept this trade. | No retry |
| `TRADE_VALUE_OUT_OF_RANGE` | The proposed exchange is outside the allowed fair-value range. | Show reference-value comparison |
| `CHAT_RATE_LIMITED` | Please wait before sending another message. | Show cooldown, preserve draft |
| `CHATBOT_RATE_LIMITED` | The strategy assistant is taking a short break. | Show retry countdown |
| `IDEMPOTENCY_KEY_REUSED` | This action key was already used for a different request. | Do not retry automatically |

## 12. Canonical Game Snapshot Contract

`GET /v1/games/:gameId/snapshot` returns a role-filtered snapshot. It includes own team private state and public game/project state, but not another team's private inventory or plans.

```json
{
  "game": {
    "id": "game_123",
    "status": "active",
    "serverTime": "2026-09-09T10:05:00.000Z",
    "activeEndsAt": "2026-09-09T10:15:00.000Z",
    "finalizationEndsAt": "2026-09-09T10:15:20.000Z",
    "revision": 104
  },
  "viewer": {
    "userId": "user_123",
    "teamId": "team_123",
    "role": "broker"
  },
  "team": {
    "citySlot": 2,
    "walletCents": 1025000,
    "health": 63,
    "totalCO2Kg": 4900,
    "co2Band": "near-average",
    "revision": 28,
    "inventory": {
      "paper": { "A": 0, "B": 2100, "C": 0, "lockedKg": 0 },
      "metal": { "A": 0, "B": 1700, "C": 0, "lockedKg": 1000 }
    },
    "wasteSources": [],
    "mrfQueue": [],
    "activeJobs": [],
    "currentHealthMission": null,
    "metrics": {}
  },
  "projects": {
    "preview": [],
    "active": [],
    "queued": [],
    "recentlyClosed": []
  },
  "teamProjectWork": [],
  "trades": {
    "inbox": [],
    "outbox": [],
    "inTransit": []
  },
  "publicLeaderboard": []
}
```

## 13. Socket.IO Event Contracts

All server events contain at minimum:

```json
{
  "eventId": "evt_123",
  "eventType": "project.claimed",
  "gameId": "game_123",
  "occurredAt": "2026-09-09T10:05:00.000Z",
  "gameRevision": 105,
  "payload": {}
}
```

### 13.1 Event targets

| Event | Target room | Payload minimum |
|---|---|---|
| `project.previewed` | game | project public card |
| `project.announced` | game | project public card |
| `project.activated` | game | project id, expiry |
| `project.claimed` | game | project id, winner city/team display, gross/net revenue, CO2 impact |
| `project.expired` | game | project id |
| `team.metrics.updated` | team | wallet, health, CO2, revisions, delta reason |
| `team.inventory.updated` | team | changed material lines, revision |
| `municipality.transport.updated` | team | source/transport status, ETA |
| `mrf.processing.updated` | team | job status, output when completed |
| `project.readiness.updated` | team | project work state, missing roles/materials |
| `trade.offer.updated` | both trade teams | offer public-to-parties state |
| `trade.delivery.updated` | both trade teams | delivery status/material arrival |
| `health-mission.updated` | team | mission/steps/result |
| `ping.created` | team or trade thread | typed ping/context |
| `chat.message.created` | channel members | sanitized message DTO |
| `game.status.changed` | game | new status/timestamps |
| `game.snapshot.required` | team | expected revision/reason |
| `admin.alert` | admin | alert code/severity/context |

### 13.2 Event ordering rule

Clients must use `gameRevision` and relevant `teamRevision` to apply events. If a client receives an event with a version gap greater than one for its own team or an unknown project transition, it must fetch the snapshot and not attempt to reconstruct missed state from visual events.

## 14. UX State and Component Specification

### 14.1 Global game shell states

| State | UI requirement |
|---|---|
| Loading snapshot | Skeleton Project Rail, metrics placeholders, no actionable controls |
| Briefing | Read-only role tutorial, project preview, chat/pings/settings active |
| Active | All authorized controls active according to server state |
| Finalizing | Visible `Final submissions` banner; disable new collection, processing, purchase, trade creation/acceptance |
| Reconnecting | Persistent status chip; disable mutation commands until snapshot/recovery succeeds; preserve local drafts |
| Completed | Route to results, retain activity/debrief data |
| Unauthorized role | Show role-specific access message and route to correct workstation |

### 14.2 Project Rail component requirements

Each project card must have these visual states:

| State | Appearance/behavior |
|---|---|
| Preview | Dimmed but readable; `Arrives in 10s`; planning allowed only after it becomes queued/active |
| Queued | Visible in rail; requirements readable; cannot readiness certify or claim; planned materials allowed |
| Active | Strong timer, role checklist, `Plan materials` and role action entry points |
| Team ready | Team-private green outline/checklist only; never expose readiness to other teams |
| Claimed by own team | Completion animation, reward receipt, project moves to history |
| Claimed by other team | Winner label, nonbinding plan release, no destructive error modal |
| Expired | Muted `Opportunity expired` state with learning hint |

Timer requirements:

- Render countdown from server `expiresAt` and synchronized server-time offset.
- Do not trigger expiry locally; wait for server terminal event/snapshot.
- At 15 seconds, add nonessential urgency visual/text cue; honor reduced-motion and sound preferences.

### 14.3 Municipality workstation

Components:

- `WasteSourceDeck`: max four cards sorted by expiry then material relevance to currently planned projects.
- `RouteChooser`: compares time, wallet, CO2 before dispatch; no default confirmation for express route.
- `TransportLane`: client-only animation linked to confirmed `arrivesAt`.
- `ProjectDeliveryDock`: readiness state, planned material total, claim preflight, final confirmation.
- `MunicipalityCityCareStep`: current mission option choices.

### 14.4 MRF workstation

Components:

- `IncomingQueue`: FIFO list with mass/composition/contamination/age.
- `ProcessingModeChooser`: compares projected outputs, cost, CO2, duration, grade, residue.
- `ProcessingLane`: one active job with server ETA.
- `RecoveredMaterialPanel`: inventory change receipt and grade label.
- `ProjectCertificationDock`: displays planned material and whether certification is currently valid.
- `MrfCityCareStep`.

### 14.5 Broker workstation

Components:

- `DemandMatrix`: active project material requirements versus owned, incoming MRF, traded-in-transit, and external availability.
- `ExternalWholesalerPanel`: quantity stepper in 0.1t increments, total cost/CO2 preview, confirmation.
- `TradeBoard`: inbox/outbox/in-transit tabs; offer form; reference value and fair-range explanation.
- `TradeThread`: only participants; links message context to offer.
- `ProcurementReadinessDock`: provenance explanation and readiness selection.
- `BrokerCityCareStep`.

### 14.6 Accessibility/interaction acceptance rules

- Every control has visible text name, accessible name, keyboard operation, focus indication, and disabled reason when unavailable.
- No control relies only on color, hover, a short animation, or sound.
- All project requirements and time critical information appear in DOM text in addition to visual tokens.
- Every confirmation dialog has clear confirm/cancel controls, focus management, and Escape behavior where safe.
- Preserve form/offer drafts after recoverable errors and reconnect.
- `Reduced motion` removes moving material tokens, card motion, urgency pulsing, and decorative particles but retains state messages.
- A simplified accessible mode may render the city operation as lists/tables rather than animated map layers; it must expose equivalent commands and information.

## 15. Facilitator/Admin Rules

### 15.1 Admin commands

| Action | Preconditions | Result |
|---|---|---|
| Start room | Room has >=2 complete ready teams; admin/authorized owner | Server-controlled 10-second countdown then briefing |
| Pause game | Game briefing/active/finalizing; admin | Freeze scheduler due action execution, show pause overlay, record audit event |
| Resume game | Paused; admin | Shift all pending due timestamps by pause duration, resume scheduler |
| Announcement | Admin | Broadcast sanitized banner/chat announcement |
| End game | Active/finalizing; explicit typed confirmation | Transition directly to finalization or completed based on selected reason; audited |
| Cancel project | Active/queued only; explicit reason | Terminal cancelled state, close plans, broadcast reason |
| Enable observer mode | Admin | Adds read-only authorized observer, no player data mutation |

### 15.2 Pause semantics

On pause:

- Store `pausedAt`.
- Scheduler does not execute game due transitions.
- Client countdowns show `Paused` and stop decreasing.
- Chat and accessibility settings remain available.
- New gameplay commands return `GAME_PAUSED`.

On resume:

- Compute `pauseDurationMs`.
- Add pause duration to every nonterminal project expiry, source expiry, transport/process/trade due time, health mission deadline, match end, and next schedule point.
- Store one audited resume event.

## 16. Activity Record Requirements

Every command and system transition writes an immutable game activity event with:

```json
{
  "gameId": "game_123",
  "sequence": 431,
  "type": "project.claimed",
  "actorType": "player",
  "actorUserId": "user_123",
  "actorRole": "municipality",
  "teamId": "team_123",
  "commandId": "uuid",
  "occurredAt": "ISO timestamp",
  "visibility": "facilitator",
  "payload": {
    "projectId": "proj_123",
    "walletDeltaCents": 476000,
    "co2DeltaKg": -1800,
    "teamRevisionBefore": 27,
    "teamRevisionAfter": 28
  }
}
```

Activity event categories:

```text
game.lifecycle.*
room.*
municipality.*
mrf.*
broker.*
trade.*
project.*
health.*
chat.metadata.*
chatbot.*
admin.*
system.*
security.*
```

The event stream is used for facilitator investigation, game replay/debrief timeline, balance analysis, error diagnosis, and future educational research subject to institutional approval.

## 17. Acceptance Test Matrix

### 17.1 Project claim

| ID | Given | When | Then |
|---|---|---|---|
| PC-01 | Active project, sufficient A/B inventory, all readiness true, health 70 | Municipality claims | Exactly required inventory consumed; wallet gets net reward; project claimed once |
| PC-02 | Project has winner already | Another team claims | `PROJECT_ALREADY_CLAIMED`; no inventory/wallet change |
| PC-03 | Team is at 19 health | Municipality claims | `HEALTH_TOO_LOW_TO_CLAIM`; no change |
| PC-04 | Two claims arrive concurrently | Transaction race | Exactly one succeeds; losing team keeps inventory |
| PC-05 | Winner CO2 2x average | Claim settles | Receipt multiplier exactly 0.85 using pre-claim snapshot |
| PC-06 | Same command retried | Duplicate idempotency request | Same original response; no second reward |

### 17.2 Municipality/MRF loop

| ID | Given | When | Then |
|---|---|---|---|
| MM-01 | Available waste source, funds, queue capacity | Standard dispatch | Wallet/CO2 charged; source transit then MRF queue after 10s |
| MM-02 | Queue cap reached | Dispatch | `MRF_QUEUE_FULL`; no charge |
| MM-03 | Source uncollected at expiry | Scheduler expires source | Source terminal expired; health -4 |
| MM-04 | MRF queue source | Balanced process completes | Correct deterministic material output, residue cost/CO2, inventory event |
| MM-05 | Held source reaches hold expiry | Scheduler runs | Landfill fallback occurs once; avoidable-delay event logged |

### 17.3 Trading

| ID | Given | When | Then |
|---|---|---|---|
| TR-01 | Broker owns offered material | Creates valid trade | Material lock created and offer visible only to parties |
| TR-02 | Recipient accepts before expiry | Accept command | Both sides settle atomically, material becomes in transit |
| TR-03 | Both accept/cancel requests race | Concurrent requests | Exactly one terminal result; locks released/settled once |
| TR-04 | Offer reaches expiry | Scheduler runs | Locks released, status expired, no delivery |
| TR-05 | Low-carbon mode | Delivery completes | 15-second timing and correct $25/150kg team logistics effects |

### 17.4 Health mission

| ID | Given | When | Then |
|---|---|---|---|
| HM-01 | Active mission | All roles submit appropriate steps | Health +8 or +10 based on high impact; mission completed |
| HM-02 | Active mission | One role submits incorrect option, others correct | Health +5; explanation identifies decision pattern, no blame |
| HM-03 | Active mission deadline passes | Scheduler runs | Health -6; mission expired once |
| HM-04 | Critical health team completes mission | Completion | Health crosses threshold; project claim controls unlock after snapshot/event |

### 17.5 Recovery/accessibility

| ID | Given | When | Then |
|---|---|---|---|
| RX-01 | Client misses event revision | Next event received | Client requests snapshot and renders canonical state |
| RX-02 | Reduced-motion preference | Material/trade/project event | State feedback remains visible; nonessential movement disabled |
| RX-03 | Keyboard-only user | Navigates all role actions | Every command is reachable, usable, and reports state/error accessibly |

## 18. Balance Validation Targets

Treat constants as initial defaults, not permanent truth. After pilot sessions, adjust only configuration values unless a rule defect exists.

Healthy target indicators for standard scenario:

| Metric | Target |
|---|---|
| Early projects claimed by at least one team | 80% or more |
| Average projects won per team in a 2-team match | 3 to 6 |
| Average projects won per team in a 6+ team match | 1 to 3 |
| Teams completing at least one health mission | 80% or more |
| Teams entering critical health | Under 25% in beginner mode |
| External purchase share of project material | 15% to 40%; neither zero nor dominant |
| Trade use in 4+ team rooms | At least 20% of teams initiate/accept a trade |
| Role blocked time | Under 25% average for every role |
| Difference in average role active time | Under 20 percentage points |
| Project claim duplicate/consistency failures | Zero tolerated |

## 19. Build Checklist

The implementation is not complete until all are true:

- [ ] Every constant above lives in versioned scenario configuration, not scattered code literals.
- [ ] All wallet/material/CO2 calculations use canonical integer units.
- [ ] Every mutating API is authenticated, role authorized, idempotent, validated, audited, and test covered.
- [ ] Project claim and trade acceptance use short atomic transactions and are race tested.
- [ ] Server scheduler, not client timers, owns every expiry/completion transition.
- [ ] Websocket events publish only after durable commit and clients reconcile version gaps through snapshot fetch.
- [ ] Role workstations share Project Rail, inventory, health mission, pings, and contextual communication.
- [ ] Auction code and Team A/B assumptions are absent from the new game domain.
- [ ] UI meets keyboard, reduced-motion, non-color, text alternative, and responsive requirements.
- [ ] Results explain wallet rank, CO2 multiplier effects, health outcomes, circular material sources, and team decisions.
- [ ] Admin/facilitator controls are audited and cannot silently alter a game's history.
- [ ] Game activity records exist for every important player/system action and comply with retention/privacy policy.

## 20. Final Implementation Instruction

Build the first release exactly as a server-authoritative cooperative circular-city workflow game. Favor clear cause-and-effect, recoverable pressure, and visible teamwork over superficial complexity.

The material pipeline must always remain understandable:

```text
Municipality collection decision
  -> MRF recovery/quality decision
    -> Broker procurement/trade decision
      -> all three project-readiness actions
        -> Municipality claims universal civic project
          -> CO2-adjusted wallet reward and city impact
```

When an implementation detail is still open, make it configurable, log the assumption, and keep the state transition deterministic, auditable, accessible, and testable.
