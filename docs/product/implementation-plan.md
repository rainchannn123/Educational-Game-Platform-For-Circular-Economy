# New Circular City Game Platform: Implementation-Ready Product, Game, UX, and Technical Plan

## 1. Document Purpose

This is the authoritative implementation plan for replacing the existing Besse web game with a new, original, real-time cooperative and competitive circular-economy game.

It is written for the engineering/design agent that will build the platform. It defines:

- the game rules and player flow;
- the responsibilities and workload of Municipality, MRF, and Broker;
- the universal project-race mechanism;
- health, CO2, wallet, trading, chatbot, and communication mechanics;
- the frontend UX/UI direction;
- a scalable but intentionally simple backend architecture;
- MongoDB persistence, activity investigation records, API/event contracts, reliability controls, testing, and delivery phases;
- a proposed clean source-code directory structure.

This plan intentionally takes inspiration from the **coordination pressure pattern** of games with shared timed work queues: visible incoming orders, time pressure, role dependency, handoffs, reprioritization, and immediate feedback. It must **not** reproduce another game's protected visual identity, characters, terminology, artwork, audio, layout, or trade dress. The new game must use an original circular-city setting, original interface, original language, and original assets.

## 2. Executive Decision Summary

### Product concept

Working concept name: **Circular City Rush**. The title is provisional and must be cleared through product and brand review.

Students operate competing circular cities. Each three-player city team converts waste into useful materials, procures missing materials, protects city wellbeing, and races other cities to complete shared civic projects first.

### Non-negotiable product rules

| Rule | Decision |
|---|---|
| Team composition | Exactly 3 active student roles: Municipality, MRF, Broker |
| Minimum match size | At least 2 teams; maximum should remain configurable, with 30 teams as the target capacity |
| Match objective | Finish universal civic projects before other teams and maximize final wallet/revenue balance |
| Primary ranking | Final wallet balance, descending |
| Tie-breakers | Lower total CO2, then higher health, then earlier final project completion timestamp |
| Global project cadence | A new project is announced every 20 seconds during the active match window |
| Project winner | First eligible team to submit all required material and role-readiness conditions; server decides atomically |
| Auction system | Removed from the new game |
| Procurement | External wholesaler retained; broker-to-broker trading dashboard replaces auction |
| Metrics retained | Wallet/revenue, City Health, and CO2 emissions |
| CO2 consequence | A team above the current room average CO2 receives a project-revenue multiplier below 1.0 |
| Health purpose | Team operational resilience maintained through parallel circular-economy side missions, not a rank input |
| Chatbot | Retained as a contextual strategy/help assistant; it cannot perform game actions or expose protected team information |
| Multiplayer authority | Backend is the sole authority for resources, timers, project wins, trades, and metrics |

### Recommended default class session

| Phase | Duration | Purpose |
|---|---:|---|
| Guided preparation | 2 minutes | Teach the three workstations, pings, shared inventory, project rail, and side mission |
| Team planning countdown | 45 seconds | Read first project preview, agree on first actions, verify connection/accessibility settings |
| Active match | 10 minutes | New project announced every 20 seconds; no new project announcements during the final 40 seconds |
| Finalization | 20 seconds | Allow already-open work to be submitted; lock new material procurement and new trades |
| Results and facilitated debrief | 3 to 8 minutes | Show financial, environmental, operational, and collaboration outcomes |

This produces a 16 to 21 minute core class activity excluding account creation. Durations must be configuration-driven and playtested. A shorter 6-minute practice mode and a 15-minute advanced mode should be supported without code changes.

## 3. Educational Goals

### 3.1 Learning outcomes

By completing one or more matches, students should be able to:

1. Explain why keeping material in circulation is generally preferable to landfill disposal.
2. Describe the dependent roles of municipal collection, MRF sorting/recovery, and market/procurement coordination.
3. Evaluate trade-offs between speed, cost, quality, transport emissions, contamination, and material availability.
4. Recognize that a high-emission operating model can reduce real economic returns, even when it wins projects quickly.
5. Collaborate under constraints by planning, communicating needs, negotiating trade-offs, and responding to bottlenecks.
6. Apply circular economy concepts to authentic city activities such as reuse, repair, source separation, recycling quality, low-carbon logistics, and procurement.

### 3.2 Learning-to-mechanic mapping

| Learning concept | Game mechanic |
|---|---|
| Waste hierarchy | Recovery gives usable material; landfill clears pressure but loses material, costs money, raises CO2, and harms health |
| Source separation and contamination | Municipality collection choice changes MRF recovery yield/quality |
| Material recovery | MRF converts waste batches into different material quantities and grades |
| Circular reuse | Recovered and traded material fulfills civic-project requirements |
| Life-cycle trade-off | Fast transport, processing, landfill, external procurement, and trade logistics have wallet/CO2 consequences |
| Sustainable procurement | Broker compares internal recovery, exchange, and expensive external purchasing |
| System interdependence | Each project requires meaningful Municipality, MRF, and Broker readiness work plus sufficient materials |
| City resilience | Side missions protect health and compete for attention with revenue projects |
| Incentives and externalities | CO2-above-average reduces project revenue; wallet rank makes environmental performance economically relevant |

### 3.3 Educational guardrails

- Do not make reflex speed, repeated clicking, drag precision, or voice communication the main determinant of success.
- Do not let speed compensate for incorrect circular-economy reasoning.
- Make every financial or emissions consequence visible before confirmation where possible.
- Use correct-but-simple models, with an information panel explaining that values are educational abstractions rather than exact municipal accounting.
- Keep competition strong but recoverable. A team that loses one project must retain viable choices.
- Include a post-match reflection and instructor evidence, because debriefing converts simulation events into transferable learning.

## 4. Core Game Model

### 4.1 The minute-to-minute loop

```text
New global civic projects appear on the Project Rail every 20 seconds
    -> Municipality identifies/selects waste sources and dispatches collection
    -> MRF receives batches and selects a recovery process and quality outcome
    -> Broker compares shared team needs, buys externally, or negotiates trades
    -> Team prepares a project delivery plan and completes all role-readiness tasks
    -> First eligible team submits the project successfully
    -> Server awards CO2-adjusted revenue and applies the project CO2 impact
    -> In parallel, each team completes health missions to protect City Health
    -> Wallet, health, CO2, inventories, projects, and communication update live
```

### 4.2 Project rail: universal, timed, and fair

Every match has a server-seeded project schedule. The same projects arrive at the same server timestamps for every team in that game.

#### Project states

| State | Meaning | Player behavior |
|---|---|---|
| `announced` | Visible as an upcoming card but not yet claimable | Teams can preview requirements and plan |
| `queued` | Announced but waiting because the active-project limit has been reached | Teams can inspect it and prepare a non-binding plan; it activates automatically when capacity opens |
| `active` | Claimable by all eligible teams | Teams can prepare and submit it |
| `claimed` | A winning transaction has been committed by one team | Other teams see winner, revenue, and carbon impact; their plans are released |
| `expired` | No team claimed it before its deadline | It becomes a missed public opportunity and moves to history |
| `cancelled` | Facilitator/system removed it before settlement | Only permitted through audited admin controls |

#### Project schedule and pressure management

1. At active match start, announce and activate one easy project.
2. Announce a new project every 20 seconds.
3. Show a preview of the next project 10 seconds before its announcement.
4. Keep at most four projects `active` at a time. Additional announced projects wait in the visible rail as `queued` and automatically activate when a current project is claimed or expires.
5. A project remains active for 75 seconds by default. This is configurable per difficulty tier.
6. Stop announcing new projects during the final 40 seconds. Continue allowing active project submissions until the finalization deadline.
7. The scheduler uses a deterministic seed, level configuration, and timestamps stored with the game, ensuring replayability and fair instructor review.

The active-project cap is important. It preserves the requested continuous incoming-project experience while preventing a 30-team class from receiving an impossible number of simultaneous objectives.

#### Project card contents

Every card must show, without requiring hover or memory:

- project name, city category, and short real-world context;
- material requirements by type and tons;
- gross revenue reward;
- project CO2 impact: `avoided CO2` (negative value) or `construction CO2` (positive value);
- time remaining and project status;
- visual role-readiness checklist: Municipality, MRF, Broker;
- difficulty tier and material complexity;
- winner when claimed;
- a concise plain-language explanation of its circular-economy relevance.

### 4.3 Atomic project win rule

A project is awarded only when the server confirms all of the following in one atomic settlement operation:

1. The game is active and accepts submissions.
2. The project is active and not already claimed or expired.
3. The submitting player belongs to the team and has the Municipality role. Municipality is the final public-project submitter because it represents city delivery. This must be clearly communicated and must not imply the other roles are secondary.
4. The project work record shows all three role readiness tasks complete by the same team.
5. The team has enough uncommitted material in the shared team inventory.
6. The team's health is above the project-claim threshold.
7. The command has a unique idempotency key and has not already been processed.
8. The wallet/revenue and CO2 reward are computed from a single pre-settlement snapshot.

If successful, the transaction commits project ownership, consumes winning material, adds net project revenue, applies project CO2 impact, writes activity/outbox records, and releases every non-winning team plan. The server broadcasts the project result only after commit.

If two teams submit at nearly the same time, the first successful committed conditional transaction wins. No browser timestamp or client-side ordering is trusted.

### 4.4 Project readiness requirement: all roles matter

Every project has three lightweight, meaningful readiness actions. These actions are distinct from providing materials and may be completed in parallel after a card becomes active.

| Role | Default readiness action | Why it matters |
|---|---|---|
| Municipality | Approve site/collection plan and reserve the city delivery slot | Connects material recovery with municipal planning and public-service delivery |
| MRF | Certify that the selected material mix is fit for the project | Connects quality, contamination, and material suitability to reuse |
| Broker | Confirm procurement and delivery budget/manifest | Connects material source, cost, and trade/external procurement to the final city investment |

The final Municipal submission must show the current inventory, role checklist, gross reward, expected CO2 multiplier range, and expected net revenue before confirmation.

This design creates positive interdependence without forcing players into arbitrary handoff delays. Each role has a decision tied to its learning objective and the shared project cannot be claimed by one player acting alone.

### 4.5 Wallet and final ranking

```text
final wallet = starting wallet
             + project net revenue
             + accepted trade proceeds
             - transport cost
             - MRF processing/disposal cost
             - external wholesaler cost
             - trade logistics/market service cost
             - health-mission direct costs (when applicable)
```

The ranked result order is:

1. Highest final wallet.
2. Lowest total CO2.
3. Highest City Health.
4. Earliest timestamp of the team's final successfully claimed project.

The result screen must make it clear that wallet decides rank, while CO2 and health shape how effectively and safely a team earns that wallet.

### 4.6 CO2 reward multiplier

The following rule is the recommended initial implementation. It fulfills the requested condition that CO2 higher than the room average reduces project revenue while avoiding a bonus for unusually low CO2.

Definitions at the instant before a project is settled:

```text
averageCO2 = mean(totalCO2 for all non-withdrawn teams in the game)
relativeCO2 = teamCO2 / max(averageCO2, 1)
excessCO2Ratio = max(0, relativeCO2 - 1)
co2RevenueMultiplier = clamp(1 - 0.15 * excessCO2Ratio, 0.55, 1.00)
netProjectRevenue = round(grossProjectRevenue * co2RevenueMultiplier)
```

Examples:

| Team CO2 relative to room average | Multiplier | Meaning |
|---|---:|---|
| At or below average | 1.00 | Receives 100% of the listed revenue |
| 2x average | 0.85 | Receives 85% of the listed revenue |
| 3x average | 0.70 | Receives 70% of the listed revenue |
| 4x average or more | 0.55 floor | Receives no less than 55%, but cannot ignore carbon performance |

Rules:

- Calculate the multiplier before applying the completed project's own CO2 impact.
- Store the room average, team CO2, multiplier, gross reward, and net reward in the permanent project award record.
- Display a clear explanation in the completion animation: for example, `High city emissions: 0.85x revenue multiplier`.
- Do not display the exact real-time opponent CO2 values during active play by default; show a team's own CO2 and a qualitative room comparison such as `Below room average`, `Near room average`, or `Above room average`. The facilitator can enable a full public metrics mode.
- Treat multiplier coefficients as game balance configuration, not hard-coded business logic.

### 4.7 Project CO2 impact

Each project template includes `projectCO2ImpactTons`.

- A negative value represents verified avoided emissions or circular benefit, such as replacing virgin material demand.
- A positive value represents construction/installation emissions.
- On completion: `team.totalCO2 = max(0, team.totalCO2 + projectCO2ImpactTons)`.
- This project impact is applied after calculating that project's revenue multiplier, avoiding a circular calculation.

The project card must label this unambiguously as `CO2 impact`, with `Avoids X tCO2e` for negative values and `Adds X tCO2e` for positive values. It must never call a positive emission amount a reward.

## 5. Detailed Role Design And Workload Balance

### 5.1 Design principles for role workload

Each role must have a continuous activity stream, a meaningful decision stream, and clear reasons to communicate. No role should be a passive supplier, a permanent bottleneck, or only a button-clicking courier.

For balance, instrument and review per role:

- active interaction time;
- decision time;
- idle/blocked time;
- number and direction of handoffs;
- material created, moved, traded, and used;
- health-mission contribution;
- chat/ping use;
- error/rework rate.

Do not rank individual students publicly by click count. Planning, verification, negotiation, and communication are legitimate contributions.

### 5.2 Municipality workstation: Collect, prioritize, and deliver

**Role fantasy:** City Operations Coordinator.

**Primary responsibility:** decide what waste enters the circular system, how urgently it moves, and which project gets final city delivery.

| Municipality task | Player decision | Result | Communication trigger |
|---|---|---|---|
| Inspect incoming waste cards | Compare origin, composition, contamination risk, mass, deadline, and collection options | Selects best future material opportunities | Tell MRF what material mix is inbound; ask Broker what material is scarce |
| Choose collection route | Standard, express, consolidated, or local-reuse route | Changes arrival time, cost, and CO2 | Coordinate whether speed is worth the CO2/revenue penalty risk |
| Dispatch waste batch | Commit one selected batch to MRF queue | Starts a client-only travel animation and server-timed arrival | Notify MRF of incoming batch and expected material value |
| Operate civic intake action | A short source-separation choice based on batch information | Can reduce contamination or improve health at small time/cost trade-off | Ask MRF whether the quality improvement is worth waiting for |
| Approve project site | Mark Municipality readiness for an active project | One of three project claim conditions | Ask MRF/Broker to finish certification/procurement before submission |
| Submit completed project | Choose one active project to claim after all conditions are met | Atomic first-completion competition | Confirm with team that no more profitable/urgent project is being missed |

**Recommended action pacing:** one meaningful municipal decision every 8 to 15 seconds, with no repeated tapping requirement.

### 5.3 MRF workstation: Recover, quality-control, and route materials

**Role fantasy:** Materials Recovery Operator.

**Primary responsibility:** transform mixed waste into useful material, make quality/time/emissions trade-offs, and protect the team from contamination/refuse costs.

| MRF task | Player decision | Result | Communication trigger |
|---|---|---|---|
| Receive batch | Inspect composition, contamination, and projected outputs | Makes incoming material opportunity visible | Tell Municipality whether collection quality was good and Broker what will be available |
| Select processing mode | Rapid sort, balanced sort, quality sort, or reject/landfill | Trades processing time/cost/CO2 against yield and grade | Ask Broker which project material is urgent before choosing speed versus quality |
| Process waste | Confirm processing choice; server completes after a short duration | Adds materials to shared inventory and refuse to waste/CO2 accounting | Notify team when a requested material is ready |
| Certify project mix | Verify selected inventory/material grade is project-suitable | Completes MRF project-readiness condition | Request a substitute/trade if quality is insufficient |
| Handle residue | Recover secondary material, send to landfill, or schedule local reuse | Prevents untreated backlog but has wallet/CO2/health impact | Ask Municipality/Broker whether preserving time or carbon is more valuable |
| Support health mission | Complete MRF-specific audit, contamination intervention, repair/reuse assessment, or material safety action | Contributes to team health mission | Coordinate side-mission timing with active project pressure |

**Recommended action pacing:** an MRF should normally make one processing or quality decision for each municipal batch and one short verification/support decision between batches. Processing must be server-timed, but the player must remain useful while waiting through project certification, residue handling, health missions, and upcoming-demand preview.

### 5.4 Broker workstation: Procure, trade, and manage circular value

**Role fantasy:** Circular Procurement and Exchange Lead.

**Primary responsibility:** keep the team supplied without wasting wallet or CO2; negotiate with other teams; make the financial/availability consequences visible.

| Broker task | Player decision | Result | Communication trigger |
|---|---|---|---|
| Read demand board | Compare active project needs, current inventory, incoming MRF output, and external prices | Identifies deficits and surplus | Tell team which materials are bottlenecks and which project is financially viable |
| Buy from external wholesaler | Choose material amount and purchase timing | Guaranteed shared inventory at premium wallet/CO2 cost | Ask if waiting for MRF/trade is safer than buying now |
| Create trade offer | Offer material/cash and request material/cash from another team | Locks offered inventory until expiry | Negotiate with target broker using trade thread and structured pings |
| Accept/reject/counter trade | Evaluate counterparty's valid offer | Executes atomic inventory/wallet/CO2 settlement | Notify Municipality/MRF that missing material is now secured |
| Confirm project procurement | Review material source and cost before Municipality submits | Completes Broker project-readiness condition | Warn team about high CO2 multiplier or wallet risk |
| Support health mission | Fund repair kit, reuse incentive, education campaign, or low-carbon service contract | Contributes to team health mission | Decide when resilience work is worth delaying a revenue race |

**Recommended action pacing:** Broker should always have a useful demand forecast, trade/external decision, or health-support opportunity. The broker must not be forced to buy something for every project; their contribution includes assessing internal output, maintaining financial capacity, and confirming the delivery plan.

### 5.5 Shared inventory and material handoff rules

- A team has one visible shared material inventory. All three roles can read it; only server-approved role actions can change it.
- Municipality creates the input waste flow.
- MRF creates recovered material supply.
- Broker obtains external/traded material and validates financial readiness.
- Municipality consumes material only when an atomic project claim succeeds.
- Teams can create project plans that show intended materials, but planning never reserves or consumes material. This prevents a team from becoming locked after another team wins a shared project.
- A project plan must show source labels such as `MRF recovered`, `external purchase`, or `trade received`, so students can understand circularity/value choices during debrief.

### 5.6 Workload rescue and role rotation

Default roles remain fixed for one match to make dependencies legible. To prevent idle time or disconnection collapse:

- Every player can view the shared Project Rail, inventory, health mission, team chat, and non-actionable team forecast.
- A player may send contextual pings from any screen.
- A `handover` action lets a team leader temporarily assign an unfinished side-mission subtask to another connected teammate after 10 seconds of inactivity, preserving accountability in the activity record.
- The facilitator can enable role rotation between rounds, not during a live round, for courses where students should experience every role.
- If a player disconnects, preserve their pending work, show a reconnect timer, and after 30 seconds enable a constrained temporary delegation path. Do not silently automate high-impact financial or project-claim choices.

## 6. Health: Parallel Circular-Economy Side Missions

### 6.1 Health model

City Health represents residents' trust, service reliability, local environmental quality, and operational resilience. It is not a ranking metric, but it prevents teams from treating financial revenue as the only goal.

Recommended starting model:

| Rule | Default |
|---|---:|
| Starting health | 70/100 |
| Passive health deterioration | -2 every 60 seconds while an unresolved health mission exists |
| Health mission completion | +8 health |
| Health mission failure/expiry | -6 health |
| Landfill/refuse incident | Additional health loss based on scenario severity |
| Low-health warning | At or below 35 |
| Project claim threshold | Health must be at least 20 |
| Critical city mode | At or below 10: project claims disabled until one health mission is completed |

The default model should not eliminate a student team instantly. It creates a soft, recoverable operational crisis. An instructor-configurable advanced mode may enable elimination at health 0, but it is not recommended before playtesting.

### 6.2 Health mission flow

1. The system generates one team-specific health mission every 60 seconds, with a maximum of one unresolved mission at a time.
2. The mission is visible to all roles in the persistent `City Care` panel.
3. Each mission has three short, role-specific steps. These can happen in parallel and normally take 10 to 25 seconds of attention, not continuous tapping.
4. Completing every step before the deadline awards health and records a circular-economy explanation.
5. A mission that expires reduces health but does not delete materials or invalidate unrelated project work.
6. Teams may intentionally defer a mission for a high-value global project, creating the desired strategic tension.

### 6.3 Initial mission library

| Mission | Municipality step | MRF step | Broker step | Learning outcome |
|---|---|---|---|---|
| Source Separation Campaign | Choose district outreach/location based on waste mix | Identify contamination risk and recommended sorting instruction | Fund low-waste campaign kit or reuse incentives | Source separation improves recovery quality and reduces contamination |
| Illegal Dumping Response | Select collection/rerouting response | Decide recoverable versus hazardous/residue pathway | Approve compliant low-carbon contractor budget | Waste leakage has social, financial, and environmental consequences |
| Repair and Reuse Pop-up | Allocate civic space/collection point | Assess salvageable items/material stream | Coordinate local repair partner or reuse voucher | Reuse/repair keeps products/materials in service longer |
| Overflowing Collection Zone | Prioritize route and public-service response | Open processing capacity/choose backlog method | Authorize consolidated low-carbon logistics | Delays, capacity, and logistics affect service health |
| Recycling Quality Audit | Report source issue and choose intervention | Perform quality sampling/classification | Purchase only needed QA/reuse supplies | Quality matters as much as collection volume |
| Community Compost and Organics Pilot | Select participating neighborhood | Verify acceptable organics stream and contamination control | Fund local end-use/market connection | Circular systems include organic resource loops where curriculum permits |
| Public Procurement Integrity Check | Confirm project is appropriate for recovered content | Certify material traceability/grade | Validate supplier/trade documentation | Circular procurement requires traceability and appropriate standards |

Mission content must be authored/approved by a circular-economy subject-matter expert. Choices should use plain language and explain why an option is preferable after resolution.

## 7. Materials, Waste, and Economy Rules

### 7.1 Initial material set

Retain the current five material types as a familiar baseline:

- Paper
- Plastic
- Metal
- Glass
- Wood

Add textiles, organics, or electronics only after the core loop has been balanced and the curriculum supports them.

### 7.2 Initial material properties

Store every value in level configuration, never in UI code.

| Material | Base external price/ton | Default MRF recovery rate | Default processing CO2/ton | Project-use CO2/ton | Teaching emphasis |
|---|---:|---:|---:|---:|---|
| Paper | 180 | 0.85 | 0.10 | 0.8 | Contamination and source separation |
| Plastic | 350 | 0.80 | 0.18 | 2.5 | High-value/high-impact recovery trade-off |
| Metal | 600 | 0.90 | 0.16 | 1.5 | Durable high-value material and reuse potential |
| Glass | 120 | 0.75 | 0.12 | 0.6 | Weight/logistics and quality sensitivity |
| Wood | 100 | 0.90 | 0.08 | 0.3 | Repair/reuse, construction, and local loop potential |

These values are starting balance inputs, not claims about real universal market prices. Faculty/content review must validate the direction and explain any simplification.

### 7.3 Waste-source cards

Municipality receives a small rolling set of waste-source cards rather than an unlimited uncontrolled spawn list.

Each card includes:

- source type: residential, commercial, industrial, construction, or community event;
- mass;
- predicted material composition;
- contamination risk;
- response deadline;
- route options;
- expected wallet and CO2 implications;
- a short educational note where appropriate.

This gives Municipality a meaningful priority decision while giving MRF predictable material information and Broker a reason to forecast shortfalls.

### 7.4 MRF process modes

Each processing action selects one visible, explainable mode:

| Mode | Time | Yield/quality | Wallet cost | CO2 | Use case |
|---|---:|---|---:|---:|---|
| Rapid sort | Short | Lower recovery / standard grade | Lower | Higher per ton | Emergency response to a project shortage |
| Balanced sort | Medium | Standard recovery / standard grade | Standard | Standard | Default dependable option |
| Quality sort | Long | Higher recovery / higher grade | Higher | Lower waste/refuse outcome | When upcoming projects reward material quality or long-term circular value |
| Safe recovery hold | Medium | No immediate output | Small | Low | Hold questionable batch pending a health/audit decision |
| Landfill fallback | Short | No usable output | Disposal cost | High | Last-resort backlog or hazardous situation response |

Exact rates must be defined in configuration and made visible before action. No hidden random failure should destroy a student's plan.

### 7.5 External wholesaler

- Only Broker can purchase from the external wholesaler.
- It sells all enabled material types in finite or unlimited stock according to match settings.
- It is a dependable but expensive fallback: default price `base price * 2.0` plus a configurable logistics CO2 cost.
- Purchase is immediate after server validation; no auction timer.
- Purchases are visibly tagged as `virgin/external procurement` or `external recycled supply` according to the intended curriculum. Do not imply every external purchase has the same circular impact.
- The external market should show expected wallet and CO2 effect before confirmation.

## 8. Broker Trading Dashboard

### 8.1 Trading objectives

The trading dashboard replaces auction with controlled, observable, broker-to-broker negotiation. It should teach that circular markets can redistribute surplus material, reduce unnecessary virgin procurement, and require trust, transparency, and logistics decisions.

### 8.2 Scope and privacy

- Only Broker players can create, accept, reject, or counter trade offers.
- All three teammates can see their team's offers, active negotiations, and completed trade history.
- A trade target sees only the offered/requested terms, not the counterparty's complete inventory.
- Each trade creates a dedicated negotiation thread visible only to the two trading teams' members plus facilitator/audit roles.
- Global room chat is disabled by default during active gameplay to reduce spam and harassment. It may be enabled by the facilitator.

### 8.3 Trade offer structure

```text
offer material: { materialType, quantity, quality? }
offer cash: optional non-negative amount
request material: optional { materialType, quantity, minimumQuality? }
request cash: optional non-negative amount
expires at: server timestamp, default 25 seconds
delivery method: standard or low-carbon, with stated cost/time/CO2
```

Rules:

1. The offering team must own the offered material/cash when creating the offer.
2. Offered material/cash is locked until accepted, rejected, cancelled, or expired.
3. A team can have at most two outgoing and two incoming active offers. Limits are configuration-driven.
4. Same-team trades are forbidden.
5. Countering an offer creates a new offer; it never mutates the original in place.
6. Every accepted trade is an atomic transaction. Both inventories, wallets, reserved amounts, logistics CO2, activity records, and events change together or not at all.
7. A trade may include material-for-cash, material-for-material, or material-plus-cash. Pure gifts are disabled by default to limit collusion; facilitators can enable them for cooperative classroom scenarios.
8. Use a configurable fair-value guardrail. Default: the estimated received/reference value must fall within 0.6x to 1.8x of the estimated given value unless the facilitator permits unrestricted negotiation.
9. Completed trade history is visible and auditable. The final debrief identifies how much material came from recovery, trade, and external purchase.

### 8.4 Trading's environmental impact

- Standard trade logistics: default `+1.6 tCO2e` to the receiving team and a small service cost.
- Low-carbon consolidated trade: longer delivery, lower CO2, optional cost trade-off.
- Travel duration is server-timed; material does not enter recipient inventory until completed.
- This preserves a circular-market benefit while preventing trade from becoming a zero-cost teleportation mechanic.

## 9. Player and Facilitator Flow

### 9.1 Student flow

```text
Landing / Sign in
  -> Create or join a three-player city team
  -> Team room: invite teammates and inspect seats
  -> Role selection: Municipality / MRF / Broker
  -> Interactive role tutorial and readiness check
  -> Match lobby: choose/enter game room
  -> Game room: see teams, settings, facilitator, and start countdown
  -> Active game: role workstation plus shared project rail and team panels
  -> Finalization and results
  -> Guided reflection, personal learning summary, optional replay/next round
```

### 9.2 Team formation and role selection

Modernize existing flow while retaining three-person structure:

1. A student creates a city team with a memorable name and six-character invite code, or joins with invite code/link.
2. The team room always displays three seats, members, connection state, leader, and selected role.
3. The leader can start role selection only when three seats are filled. Admin testing mode can allow bot/placeholder seats only outside assessed matches.
4. Role cards include a 20-second interactive preview, responsibilities, accessibility notes, and expected collaboration pattern.
5. Roles are claimed first-available and may be changed until all teammates confirm `Ready`.
6. A shared readiness checklist confirms audio optionality, text chat/pings, motion setting, and basic controls before match room entry.
7. The team can practice one safe, untimed project chain before entering a competitive room.

### 9.3 Game room and start controls

| User type | Default capability |
|---|---|
| Team leader | Create/join/leave a public room with their complete team |
| Student teammate | See room status; cannot move the whole team without leader authority |
| Facilitator/admin | Create public/private classroom rooms, set scenario and capacity, start/pause/resume/end game, observe telemetry |

Rules:

- Room minimum is two complete teams; maximum defaults to 30 teams/90 students.
- A room owner leaving transfers ownership to another team leader for public rooms.
- A facilitator-owned classroom room always remains facilitator controlled.
- Start requires every team complete and role-ready, unless facilitator deliberately enables a documented override.
- A 10-second server-controlled start countdown is broadcast after facilitator/start-owner confirmation.
- The game begins only once, through a server idempotency key and status transition transaction.

### 9.4 Admin monitoring flow

The admin monitor is read-mostly and optimized for classroom facilitation, not intrusive surveillance.

Show:

- room timer, game status, and project schedule;
- project rail with claimed/expired status and winners;
- team cards: wallet, health band, CO2 band, active project plans, unresolved health mission, connection counts;
- material flow summary: collected, recovered, landfilled, traded, externally purchased, and project-consumed;
- trade offers and completed trades;
- action/event feed with filters;
- operational alerts: health critical, inactive role, disconnect, scheduler delay, unprocessed outbox events;
- pause/resume, announcement, end-game, and scenario control actions, all strongly confirmed and permanently audited.

Do not expose private chatbot prompts or private team chat content to all students. Admin access must be role-gated, policy-documented, and logged.

## 10. UX/UI Direction

### 10.1 Visual identity

Create an original **animated circular city control room** rather than an imitation kitchen or restaurant interface.

Suggested visual language:

- Aerial/isometric-inspired city map panels, using original vector art and simple layered CSS/SVG animation.
- Material tokens travel between collection, recovery, exchange, and project sites after server-confirmed events.
- Strong civic-industrial palette: deep navy/charcoal base, renewable teal and leaf green for circular flow, amber for time pressure, warm coral for risk, and distinctive material patterns/icons.
- Use high-contrast text and labels; color never carries meaning alone.
- Use generous card spacing, readable type, short labels, and quiet backgrounds behind decision content.
- Use transform/opacity animations, particles only as nonessential decoration, and reduced-motion alternatives.

### 10.2 Shared game screen anatomy

Desktop/laptop is the primary active-play layout. All essential flows must remain responsive and keyboard-operable on tablet and mobile, but a desktop is recommended for the highest-density classroom game.

```text
--------------------------------------------------------------------------
| Header: Match timer | Wallet | Health | CO2 band | Connection | Help    |
--------------------------------------------------------------------------
| Global Civic Project Rail: upcoming -> active cards -> claimed history  |
--------------------------------------------------------------------------
| Role workstation (main)             | Team Operations (persistent)     |
| - role-specific task queue           | - shared inventory                |
| - decision panel                     | - material demand forecast        |
| - actions and progress               | - City Care side mission          |
|                                     | - contextual structured pings     |
--------------------------------------------------------------------------
| Animated city/material-flow strip    | Chatbot / team chat / trade tabs  |
--------------------------------------------------------------------------
```

### 10.3 Role-specific screen behavior

| Role | Main visual focus | Persistent shared information |
|---|---|---|
| Municipality | City districts, waste source cards, routes, active deliveries, project-submission dock | Project Rail, team inventory, MRF incoming status, health mission, team chat/pings |
| MRF | Recovery line, incoming queue, process modes, quality/refuse result, certification dock | Project Rail, inventory demand forecast, municipal inbound batches, health mission, team chat/pings |
| Broker | Demand matrix, external market, trade inbox/outbox, negotiation threads, procurement confirmation dock | Project Rail, inventory/incoming output, wallet/CO2 forecast, health mission, team chat/pings |

### 10.4 Animation and feedback rules

Animations must reinforce state, never replace it.

| Event | Animation | Persistent confirmation |
|---|---|---|
| Waste dispatched | Vehicle/token moves from district to MRF | Delivery card with server arrival time |
| MRF processing completes | Material tokens emerge; residue is visibly separated | Exact material, wallet, CO2, and quality delta |
| Trade accepted | Two-city route animation; reserved material indicator | Trade receipt and ETA |
| Project becomes active | Project card enters rail with short sound/visual cue | Card state, deadline, requirements |
| Project won | Winning city project site activates; revenue counter updates | Winner, multiplier, gross/net revenue, CO2 impact |
| Health mission completed | City-health pulse / greenery restoration | Health delta and lesson explanation |
| Failure or blocked action | Calm, localized shake/highlight only | Plain-language cause and recovery option |

Use the Web Animations API or a light animation library such as Motion for React. Do not run a server-synchronized 60 FPS world simulation. The server sends semantic event data; the client renders local animation.

### 10.5 Onboarding and anti-frustration UX

1. Explain only one new mechanic at a time through interactive practice.
2. Start the first guided match with one simple active project before overlapping projects appear.
3. Make the material dependency chain visible at all times: `collect -> recover -> procure/trade -> submit`.
4. Show an action's expected wallet, time, health, and CO2 impact before irreversible confirmation.
5. Preserve planning on a lost project; release plans automatically and propose alternate active projects.
6. Provide a `What can I do next?` context panel for idle/blocked players.
7. Use structured pings attached to objects: `Need metal`, `Batch arriving`, `Please certify`, `Trade offer`, `Health mission now`, `Project ready`.
8. Provide undo/cancel before a server action settles where the learning goal permits it. Do not undo already completed global project claims.
9. Never use public individual blame. Team results discuss bottlenecks and decisions, not a `worst player` label.

### 10.6 Accessibility requirements

Target WCAG 2.2 AA for the web application and apply game accessibility guidance to active-play behavior.

Mandatory requirements:

- Full keyboard operation, visible focus, logical tab order, and no keyboard traps.
- Every drag-like interaction has an equivalent button/menu action; dragging is never required.
- No action requires repeated tapping, simultaneous input, voice input, or precise timing.
- Material types, urgency, role, and CO2 bands use icon/text/pattern plus color.
- Configurable font scale, contrast mode, clear readable default text, and responsive reflow.
- `prefers-reduced-motion` support; no essential information only in motion; no flashing hazards.
- Optional game-speed/accessibility mode for practice or accommodated class sessions. Match settings must disclose when a shared timer setting applies to all teams.
- Separate volume/mute controls for effects, announcements, and music; essential sounds have visual/text equivalents.
- Text chat and structured pings are available; voice is optional and never required.
- Persistent captions/status messages for project changes, errors, and team events.
- A screen-reader-friendly simplified view exposes Project Rail state, inventory, task queue, timers, and action results as structured content.
- Save user accessibility preferences before joining a timed room.

## 11. Chatbot and Communication Plan

### 11.1 Chatbot roles

Retain the existing chatbot concept, but separate its responsibilities:

| Mode | Audience | Allowed behavior |
|---|---|---|
| Game Coach | Individual/team | Explain roles, terminology, current mechanics, and non-authoritative strategy possibilities |
| Circular Economy Tutor | Individual/team | Explain why recovery, reuse, source separation, low-carbon logistics, and procurement choices matter |
| Debrief Guide | Team after match | Ask reflection prompts based on authorized aggregate event data |
| Team Chat | Team members | Human messages and structured pings only; no AI impersonation |
| Trade Thread | Two trading teams | Negotiation messages plus structured offer state |

### 11.2 Chatbot safety and data boundaries

- The chatbot never calls game mutation APIs or completes a player action.
- It may read only the requesting team's authorized current summary, not another team's private inventory, active plan, direct messages, or hidden schedule.
- It must identify strategy suggestions as suggestions, not guarantees.
- Its game-rules knowledge comes from versioned scenario/rule documents and approved learning content.
- It must not fabricate current state. When current state is unavailable, say so and offer general guidance.
- Chat prompts/responses are stored only under an explicit retention policy; sensitive personal data must not be sent to an external LLM provider without approval.
- Apply authenticated rate limits, maximum length, input sanitization, abuse reporting, and moderation policy to all human chat.

### 11.3 Communication event design

Use human-readable messages plus structured events:

- `need-material` with material type, amount, and project context;
- `batch-dispatched` with expected arrival;
- `material-ready` with material quantity/quality;
- `project-ready-for-role` with missing readiness role;
- `trade-offer-received`;
- `health-mission-urgent`;
- `blocked` with selected reason;
- `thank-you/acknowledged` lightweight confirmation.

Structured pings reduce typing burden and preserve context in an activity record.

## 12. Recommended Technical Architecture

### 12.1 Architectural approach

Build a **modular monolith with a separately deployable scheduler/worker**, not a microservice mesh.

Rationale:

- The game has a manageable domain and benefits from one consistent TypeScript language and shared contracts.
- The main reliability risk is real-time state correctness, not independent business-service scale.
- A modular monolith is easier for future human developers to understand, test, deploy, and extend.
- A worker process isolates timed jobs, outbox delivery, activity projection, and scheduled game events from HTTP/socket request latency.
- Clear module boundaries make later extraction possible only if measured load demands it.

### 12.2 Recommended stack

| Layer | Recommendation | Reason |
|---|---|---|
| Monorepo tooling | pnpm workspaces plus Turborepo or Nx | Shared type contracts, reproducible builds, explicit app/package boundaries |
| Web app | Next.js App Router, React 19, TypeScript, CSS Modules, and native CSS custom properties | Readable component-owned styles with an explicit, framework-independent design-token system; Tailwind is not used |
| Client data | TanStack Query for REST snapshots; Zustand for ephemeral UI/session state | Avoids treating websocket events as a global mutable database |
| API | Node.js 20+, Express 5, TypeScript, Zod | Reuses team familiarity and current backend foundation |
| Realtime | Socket.IO with typed event contracts | Rooms, reconnection, presence, acknowledgements, and familiar existing foundation |
| Game command transport | Authenticated REST for mutations; websocket for broadcast/presence/chat | Simpler idempotency, observability, retry, and authorization for authoritative actions |
| Primary persistence | MongoDB Atlas replica set with Mongoose or MongoDB driver | Required platform store; transactions support rare multi-document settlement |
| Realtime scale/cache | Redis 7+ with Socket.IO sharded Redis adapter; Redis also stores rate-limit/presence/cache data | Supports multiple API/socket instances without broadcasting manually between nodes |
| Worker queue | Mongo outbox plus worker polling/lease initially; optionally BullMQ only when operational needs justify it | Keeps critical game correctness in Mongo; avoids unnecessary broker dependency at first |
| Object/asset storage | CDN-backed object storage for original static art/audio | Keeps application deployment lean |
| Monitoring | Structured logs, OpenTelemetry-compatible metrics/traces, health endpoints, error tracking | Required to diagnose live classroom sessions |
| Tests | Jest/Vitest for engine/module tests, Supertest for API, Playwright for E2E, Artillery/k6 for load | Covers correctness, flow, concurrency, and load |

### 12.3 Command/query/realtime boundary

Use this rule consistently:

- **REST commands:** all game-changing actions, with idempotency keys and structured responses.
- **REST queries:** initial page load, recovery snapshot, results, admin historical investigation, content management.
- **Socket.IO:** authenticated room join/leave, presence, typed domain-event broadcasts after commit, chat/pings, facilitator notifications, and reconnect hints.
- **No client-to-server socket mutation for core game state in v1.** This avoids duplicate command, ordering, and retry ambiguity under poor networks.

Client interaction flow:

```text
Player clicks action
  -> client validates basic UI state and creates UUID idempotency key
  -> POST command with commandId and expected team revision
  -> API authenticates/authorizes and executes server-side rule
  -> state + event/outbox commit succeeds or fails
  -> API returns accepted/rejected command result
  -> worker/realtime publisher broadcasts semantic event
  -> clients update local cache/store and run local animation
  -> if client missed event/reconnects, it fetches canonical snapshot
```

### 12.4 Server-authoritative game engine

The browser must never calculate authoritative wallet, health, CO2, inventory, project status, winner, trade result, or timer expiry.

The pure engine package receives a command and canonical state, validates all invariants, and returns a deterministic state-transition result:

```text
input: command + actor identity + canonical game/team/project state + server time
output: accepted/rejected result + state mutations + domain events + audit entries
```

Benefits:

- Unit-testable rules without Express, MongoDB, Socket.IO, or UI.
- Deterministic replay using game seed and recorded commands.
- Easier balance simulation.
- Reduced bug risk from frontend/backend rule duplication.

### 12.5 One authoritative state model

Do **not** repeat the old design's strategy of duplicating the entire room game state into a separate document for every team.

Use separate, normalized aggregates:

| Aggregate | Purpose |
|---|---|
| `Game` | Global match lifecycle, seed, scenario/config snapshot, timers, schedule pointers, status, revision |
| `GameTeamState` | One team's wallet, health, CO2, inventory, queues, active job summaries, team revision, status |
| `GameProject` | One universal project card, status, timing, requirements, winner/award fields |
| `ProjectTeamWork` | Per-team readiness checklist and plan for an active project; short-lived/archived when project closes |
| `TradeOffer` | Offer terms, locked inventory/cash, expiry, status, counter relationship |
| `HealthMission` | One team-specific mission with role steps, deadline, result |
| `GameActivityEvent` | Append-only investigation/replay event stream |
| `OutboxEvent` | Durable post-commit broadcast/projection work item |

This keeps high-frequency single-team actions narrow and allows rare cross-document settlements to use a transaction.

### 12.6 Timers and scheduler design

Never create one `setInterval` per connected client or per API instance. Never trust a client timer for settlement.

Use a single scheduler worker pattern:

1. Every second, the worker queries `Game` documents whose `nextScheduledAt <= now` and whose lease is absent/expired.
2. It atomically acquires a short lease using a conditional update.
3. It processes due actions based on server timestamps: announce project, activate queued project, expire project, create/expire health mission, complete transport, complete processing, complete trade delivery, begin finalization, end game.
4. It commits state/events/outbox records and calculates the next schedule timestamp.
5. If a worker fails, another instance claims the expired lease. Every task is idempotent by game/entity/status transition.

Timed game actions should be represented as records with `status`, `dueAt`, and unique identifiers, not as in-memory promises. This makes restarts and multi-instance deployment safe.

### 12.7 Realtime scaling and recovery

- Socket connections authenticate with short-lived JWT/session token during handshake.
- A connected player joins only approved rooms: `user:{id}`, `team:{gameId}:{teamId}`, `game:{gameId}`, and admin room when authorized.
- Socket.IO instances use a Redis sharded adapter in production. Configure private network, TLS, Redis ACLs, and dedicated credentials. Redis Pub/Sub is trusted infrastructure, not client-facing.
- Configure load-balancer sticky sessions for Socket.IO when using multiple instances.
- Broadcast **small semantic events/deltas**, not full game snapshots. Examples: `project.announced`, `team.inventory.changed`, `trade.accepted`, `health.updated`.
- Coalesce noncritical visual/presence events. Do not emit one event per animation frame.
- Enable Socket.IO connection recovery only with a compatible adapter or treat recovery as best effort. Regardless, the client must fetch canonical snapshot after reconnect if state revision differs.
- Every event includes `gameId`, entity id, `revision` or version, server timestamp, and event id.
- Client ignores stale revisions, detects a revision gap, and calls `GET /games/:id/snapshot`.

### 12.8 Concurrency and consistency strategy

| Operation | Consistency implementation |
|---|---|
| Municipality collection/process action | Single `GameTeamState` conditional update with expected revision; command idempotency record |
| Project planning/readiness step | Upsert one `ProjectTeamWork` document with role authorization and revision check |
| Project claim | Short Mongo transaction across project, team state, project work, activity/outbox; project conditional status guards winner |
| External purchase | Short transaction across team state, stock/config constraints, activity/outbox |
| Trade create | Conditional team update reserves offered material/cash; creates offer in short transaction |
| Trade accept | Short transaction validates offer status/expiry and both teams' inventory/locks, then settles both state documents |
| Timer event | Scheduler lease plus idempotent status transition, transaction only where multiple entities change |
| Chat/ping | Separate rate-limited append/broadcast path; never blocks gameplay command processing |

Rules:

- Every mutating request includes `Idempotency-Key` and a client command UUID.
- Every team action includes expected `teamRevision` when changing a team aggregate.
- Use MongoDB's callback transaction API for multi-document changes, with retries for transient errors.
- Keep transactions short. Do not run network calls, LLM calls, animations, or arbitrary loops inside them.
- Serialize final project claims through conditional state transition, not an application-level mutex.
- Emit websocket events only from durable outbox delivery after database commit.

## 13. Data Model and MongoDB Plan

### 13.1 Core collections

#### `users`

Reuse/modernize existing account model.

Key fields:

- `_id`, `displayName`, `email` or institutional identity reference;
- `roles`: `student`, `facilitator`, `admin`;
- accessibility preferences;
- current team/room references only as convenience pointers, never authoritative membership;
- consent/retention flags;
- timestamps.

#### `teams`

Persistent pre-game student group.

Key fields:

- `_id`, `name`, `inviteCode`, `leaderUserId`;
- `members`: exactly up to three with selected role and ready status;
- `status`: `forming`, `role-selecting`, `ready`, `in-room`, `in-game`, `archived`;
- timestamps.

Indexes:

- unique `inviteCode`;
- `members.userId, status`;
- `leaderUserId, updatedAt`.

#### `game_rooms`

Pre-game room/lobby.

Key fields:

- `_id`, `code`, `name`, `visibility`, `passwordHash?`, `ownerUserId?`, `facilitatorUserId?`;
- `scenarioId`, `maxTeams`, `status`;
- seating array `{ teamId, citySlot, joinedAt, readyAt }`;
- start configuration snapshot and timestamps.

Indexes:

- unique `code`;
- `status, updatedAt` for room list;
- `seating.teamId, status`;
- TTL/cleanup only for abandoned waiting rooms after documented retention period.

#### `games`

One global authoritative match record.

Key fields:

- `_id`, `roomId`, `scenarioVersion`, `configSnapshot`, `seed`;
- `status`: `scheduled`, `briefing`, `active`, `finalizing`, `completed`, `cancelled`;
- `startedAt`, `activeEndsAt`, `finalizationEndsAt`, `completedAt`;
- `nextScheduledAt`, `schedulerLease`, `schedulerLeaseUntil`;
- project schedule cursor, active project count, participant team ids;
- global revision, admin control history summary.

Indexes:

- `status, nextScheduledAt` for scheduler;
- `roomId` unique;
- `completedAt` for reporting.

#### `game_team_states`

One canonical mutable state document per game/team. It should remain compact.

Key fields:

- `gameId`, `teamId`, `citySlot`;
- `wallet`, `health`, `totalCO2`, `status`, `revision`;
- material inventory map by material/quality;
- current waste cards, active transports/process jobs summary, current health mission id;
- metrics counters: collected, recovered, landfilled, traded, externalPurchased, projectsWon;
- role member ids and connection summary;
- timestamps.

Indexes:

- unique compound `gameId, teamId`;
- `gameId, wallet` for result projections;
- `gameId, status`.

#### `game_projects`

One record per globally announced project.

Key fields:

- `gameId`, `sequence`, `templateId`, `templateVersion`;
- name, context, requirements, role readiness requirements;
- gross revenue, project CO2 impact, `announcedAt`, `activeAt`, `expiresAt`;
- `status`, `winnerTeamId?`, `claimedAt?`;
- settlement snapshot: average CO2, winner CO2, multiplier, gross/net revenue;
- version and timestamps.

Indexes:

- unique `gameId, sequence`;
- `gameId, status, activeAt`;
- `gameId, expiresAt`;
- partial unique guard for only one winner field is not required; conditional status transition enforces it.

#### `project_team_work`

Per-team project readiness/planning state. Archive or mark closed when a global project settles.

Key fields:

- `gameId`, `projectId`, `teamId`;
- readiness `{ municipality, mrf, broker }` with actor/timestamp;
- planned material map and sources;
- current work status, revision, timestamps.

Indexes:

- unique `projectId, teamId`;
- `gameId, teamId, updatedAt`.

#### `trade_offers`

Key fields:

- `gameId`, `offeringTeamId`, `recipientTeamId`;
- offer/request terms, logistics mode, estimated reference values;
- status: `open`, `countered`, `accepted`, `rejected`, `cancelled`, `expired`, `in-transit`, `completed`;
- parent/counter offer id, `expiresAt`, `deliveryDueAt?`;
- resource-lock references, settlement receipt, timestamps.

Indexes:

- `gameId, status, expiresAt`;
- `offeringTeamId, status`;
- `recipientTeamId, status`.

#### `health_missions`

Key fields:

- `gameId`, `teamId`, `templateId`, `status`;
- role steps with selected option, correct/appropriate result, actor and time;
- created/expiry/completion time; health delta; explanatory feedback.

Indexes:

- `gameId, teamId, status`;
- `status, expiresAt` for scheduler.

#### `game_activity_events`

Append-only, immutable investigation/replay stream.

Key fields:

- `gameId`, `teamId?`, `actorUserId?`, `actorRole?`;
- `sequence`, `type`, `occurredAt`, `commandId?`;
- redacted safe payload: action inputs, resource delta, before/after summary, correlation id, result, failure reason;
- `visibility`: `team`, `facilitator`, `admin`, `private`.

Indexes:

- `gameId, sequence` unique;
- `gameId, teamId, occurredAt`;
- `actorUserId, occurredAt`;
- `type, occurredAt` for operational analysis.

Do not place secrets, access tokens, raw authentication headers, unfiltered LLM prompts, or unredacted private chat data in these events.

#### `outbox_events`

Durable events waiting for broadcast/projection.

Key fields:

- aggregate type/id, event type/version, payload, visibility targets;
- createdAt, publishedAt, attempt count, lease fields, failure details.

Indexes:

- `publishedAt, leaseUntil, createdAt` for worker delivery;
- `aggregateId, createdAt`.

### 13.2 Activity-record retention and privacy

- Store granular game activity records for a documented retention period agreed with the institution.
- Separate gameplay audit events from chat content. Use stricter access controls and a shorter retention policy for chat.
- Give administrators aggregated investigation dashboards by default; require an authorized reason/audit log for detailed student-level access.
- Provide a data-export/deletion process consistent with institutional privacy obligations.
- Pseudonymize data used for balance analysis whenever possible.

## 14. API and Realtime Contract Plan

All request/response and socket payload types live in a shared `@circular-city/contracts` package. Every contract has a versioned schema validated by Zod on server boundaries.

### 14.1 REST resource groups

| Resource | Example endpoints | Purpose |
|---|---|---|
| Auth/profile | `GET /v1/me` | Current identity and accessibility settings |
| Teams | `POST /v1/teams`, `POST /v1/teams/join`, `POST /v1/teams/:id/roles`, `POST /v1/teams/:id/ready` | Team formation and role readiness |
| Rooms | `GET /v1/rooms`, `POST /v1/rooms`, `POST /v1/rooms/:code/join`, `POST /v1/rooms/:code/leave`, `POST /v1/rooms/:code/start` | Room lifecycle |
| Game snapshots | `GET /v1/games/:gameId/snapshot`, `GET /v1/games/:gameId/results` | Initial/recovery and results reads |
| Municipality commands | `POST /v1/games/:id/municipality/collect`, `POST /.../route`, `POST /.../project-readiness`, `POST /.../projects/:projectId/claim` | Municipality actions |
| MRF commands | `POST /v1/games/:id/mrf/process`, `POST /.../certify-project`, `POST /.../residue` | MRF actions |
| Broker commands | `POST /v1/games/:id/broker/external-purchases`, `POST /.../trades`, `POST /.../trades/:id/accept`, `POST /.../project-readiness` | Broker actions |
| Health commands | `POST /v1/games/:id/health-missions/:id/steps` | Role-specific side mission steps |
| Communication | `POST /v1/games/:id/pings`, `POST /v1/chat/messages`, `POST /v1/chatbot/messages` | Typed communication and chatbot queries |
| Admin | `GET /v1/admin/games/:id/monitor`, `POST /.../pause`, `POST /.../resume`, `POST /.../announce`, `GET /.../activity` | Monitoring and audited facilitator controls |

Every mutating endpoint must require:

- authorization for the game/team/role;
- `Idempotency-Key` header;
- body `commandId` UUID;
- expected aggregate/team revision where relevant;
- Zod validation;
- rate limit appropriate to the action;
- standardized error object with error code, user-safe message, retryability, and current state hint where safe.

### 14.2 Socket event families

#### Server to client

```text
room.updated
room.started
game.status.changed
game.snapshot.required
project.announced
project.activated
project.readiness.updated
project.claimed
project.expired
team.metrics.updated
team.inventory.updated
municipality.transport.updated
mrf.processing.updated
trade.offer.created
trade.offer.updated
trade.delivery.completed
health-mission.created
health-mission.updated
health.updated
chat.message.created
ping.created
chatbot.response.ready
presence.updated
admin.alert
```

#### Client to server

Only non-authoritative realtime requests:

```text
socket.join-game
socket.leave-game
presence.heartbeat
chat.typing
chat.read
```

All event payloads must be small, typed, versioned, and include server timestamps and relevant revision(s). Avoid full object graphs in broadcast events.

## 15. Proposed Working Directory and Code Structure

### 15.1 Migration strategy

Do not gradually rewrite the old `Besse-frontend` and `Besse-backend` gameplay modules in place. Their auction/pairing/duplicated-state assumptions are too different.

Build the replacement as a new monorepo within the workspace, retain the old platform as read-only reference during migration, and switch deployment only after acceptance testing.

Recommended top-level target:

```text
jun5-before-sh/
  legacy-besse/                         # Move or treat current old frontend/backend as reference only
  circular-city-game/                   # New implementation root
    apps/
      web/
      api/
      worker/
    packages/
      contracts/
      game-engine/
      game-content/
      ui/
      config/
      test-fixtures/
    infra/
    docs/
    scripts/
    package.json
    pnpm-workspace.yaml
    turbo.json
    README.md
```

If moving existing directories is disruptive, create `circular-city-game/` first and leave `Besse-frontend/` and `Besse-backend/` unchanged. Do not delete old code until the new build is accepted and archived.

### 15.2 New frontend structure

```text
apps/web/
  app/
    (public)/
      page.tsx
      how-to-play/page.tsx
      accessibility/page.tsx
    (auth)/
      sign-in/page.tsx
      register/page.tsx
    (player)/
      teams/page.tsx
      teams/[teamId]/page.tsx
      rooms/page.tsx
      rooms/[roomCode]/page.tsx
      games/[gameId]/
        layout.tsx
        municipality/page.tsx
        mrf/page.tsx
        broker/page.tsx
        results/page.tsx
        debrief/page.tsx
    (facilitator)/
      facilitator/page.tsx
      facilitator/rooms/[roomCode]/page.tsx
      facilitator/games/[gameId]/page.tsx
    api/                                 # Only Next BFF routes if later required; avoid duplicating game API
  components/
    game-shell/
    project-rail/
    team-operations/
    city-care/
    municipality/
    mrf/
    broker/
    trading/
    chat/
    chatbot/
    facilitator/
    results/
    onboarding/
    accessibility/
  features/
    auth/
    teams/
    rooms/
    game/
    projects/
    inventory/
    health-missions/
    trading/
    communication/
    results/
  hooks/
    useGameSnapshot.ts
    useGameRealtime.ts
    useGameCommand.ts
    useRoleGuard.ts
    useReducedMotion.ts
  lib/
    api-client/
    socket/
    command-idempotency/
    formatters/
    accessibility/
  stores/
    sessionStore.ts
    gameUiStore.ts                       # Ephemeral panel/animation state only
  styles/
    globals.css                          # Reset, document defaults, global accessibility styles only
    tokens.css                           # Color, typography, spacing, radius, shadow, z-index, and motion tokens
    animations.css                       # Shared nonessential keyframes and reduced-motion overrides
    utilities.css                        # Small, approved layout/accessibility helpers only
  public/
    assets/
  tests/
```

Frontend rules:

- Feature components do not call Axios/fetch directly; feature API clients/hooks do.
- Server data belongs in TanStack Query cache; Zustand is for local UI/animation/session state.
- Role pages reuse common `GameShell`, `ProjectRail`, `TeamOperationsPanel`, `CityCarePanel`, `ChatDock`, and event-animation infrastructure.
- The frontend consumes shared contracts from `packages/contracts`; do not duplicate DTO types.
- Animations subscribe to semantic event state and never become an alternate source of truth.
- Tailwind CSS is explicitly excluded. Use CSS Modules named `ComponentName.module.css` beside each component for component-specific styling.
- Use `styles/tokens.css` custom properties for reusable visual values. Do not introduce raw colors, arbitrary spacing, typography values, shadows, or z-index values in component modules when a token exists.
- Do not use React inline style objects for normal layout/styling. They are permitted only to supply a dynamic CSS custom property calculated from authoritative UI state.
- Use semantic `data-state`, `data-role`, and `data-urgency` attributes for variants such as active/queued/claimed/expired, rather than building large conditional class strings.
- Every module must support keyboard focus, `prefers-reduced-motion`, non-color-only state signaling, and responsive layout behavior.

### 15.2.1 CSS Module and design-token standard

The new UI uses ordinary CSS, not a utility-CSS framework. This is a deliberate maintainability choice for a game with many named role, timer, animation, accessibility, and error states.

```text
components/
  project-rail/
    ProjectRail.tsx
    ProjectRail.module.css
    ProjectCard.tsx
    ProjectCard.module.css
  municipality/
    WasteSourceDeck.tsx
    WasteSourceDeck.module.css
```

CSS ownership rules:

1. Import `globals.css`, `tokens.css`, `animations.css`, and `utilities.css` once from the root application layout.
2. Keep global selectors deliberately minimal. Do not define generic global `.card`, `.button`, `.title`, or role-specific classes.
3. Place each component's layout, state styles, responsive behavior, and local pseudo-elements in its matching CSS Module.
4. Define repeated visual values as custom properties in `tokens.css`, for example `--color-surface-raised`, `--space-4`, `--radius-lg`, `--shadow-card`, and `--motion-fast`.
5. Place shared `@keyframes` in `animations.css`. Motion must use transform/opacity where possible and include a reduced-motion alternative.
6. Use text, icon, and pattern together for material, risk, and urgency status. CSS color alone must never carry essential meaning.
7. Prefer a small set of reusable components from `packages/ui` over copied CSS blocks. Shared components include button, card, badge, dialog, panel, progress indicator, material token, and status chip.
8. Do not introduce a second CSS-in-JS library. CSS Modules plus custom properties are the only default styling system.

### 15.3 New API structure

```text
apps/api/src/
  app.ts
  server.ts
  bootstrap/
    env.ts
    database.ts
    redis.ts
    socket.ts
    observability.ts
  modules/
    auth/
      auth.routes.ts
      auth.controller.ts
      auth.service.ts
      auth.repository.ts
      auth.schemas.ts
    teams/
    rooms/
    games/
      game.routes.ts
      game.controller.ts
      game.service.ts
      game.repository.ts
      game.schemas.ts
      game.authorizer.ts
    municipality/
      municipality.routes.ts
      municipality.controller.ts
      municipality.command-service.ts
    mrf/
    broker/
    projects/
      project-claim.service.ts
      project-scheduler.service.ts
    trades/
      trade-offer.service.ts
      trade-settlement.service.ts
    health-missions/
    communication/
    chatbot/
    admin-monitoring/
    activity/
  domain/
    entities/
    policies/
    value-objects/
    errors/
  persistence/
    models/
    repositories/
    indexes/
    migrations/
  realtime/
    socket-auth.ts
    room-membership.ts
    event-publisher.ts
    event-contracts.ts
  middleware/
    authenticate.ts
    authorize.ts
    idempotency.ts
    request-context.ts
    rate-limit.ts
    error-handler.ts
  shared/
    logger.ts
    response.ts
    time.ts
    ids.ts
  tests/
```

API rules:

- Keep routes thin: parse/validate/authenticate -> invoke command service -> return typed response.
- Put business rules in engine/domain policy and application command services, not controllers.
- Repositories own persistence queries; services do not contain scattered raw Mongoose calls.
- No module may import another module's model directly. Use exported service/repository interfaces.
- Every module owns its route/controller/service/schema/tests; shared utilities are deliberately small.

### 15.4 Worker structure

```text
apps/worker/src/
  worker.ts
  bootstrap/
    env.ts
    database.ts
    redis.ts
    observability.ts
  jobs/
    game-scheduler.job.ts
    project-expiry.job.ts
    health-mission-expiry.job.ts
    transport-completion.job.ts
    trade-delivery.job.ts
    outbox-publisher.job.ts
    activity-projection.job.ts
    room-cleanup.job.ts
  leases/
    mongo-lease.service.ts
  services/
    scheduled-game-transition.service.ts
    outbox-delivery.service.ts
  tests/
```

### 15.5 Shared packages

```text
packages/contracts/src/
  api/
  events/
  entities/
  schemas/
  errors/

packages/game-engine/src/
  commands/
  transitions/
  rules/
    project-claim.ts
    co2-multiplier.ts
    processing.ts
    health-missions.ts
    trade-validation.ts
    rankings.ts
  simulation/
  test-helpers/

packages/game-content/src/
  scenarios/
  project-templates/
  health-mission-templates/
  materials/
  localization/

packages/ui/src/
  components/
  tokens/
  icons/
  motion/
  accessibility/

packages/config/src/
  eslint/
  typescript/
  postcss/
  jest/

packages/test-fixtures/src/
  builders/
  scenarios/
  seeds/
```

### 15.6 Infrastructure and documentation

```text
infra/
  docker/
  compose/
  terraform-or-bicep/
  kubernetes/                            # Only if deployment scale justifies it
  monitoring/
  load-test/

docs/
  product/
    game-design-spec.md
    balancing-guide.md
    content-authoring-guide.md
  architecture/
    adr/
    realtime-contracts.md
    data-retention.md
    security-model.md
  operations/
    runbook.md
    incident-playbook.md
  testing/
    test-matrix.md
```

## 16. Reliability, Security, and Performance Requirements

### 16.1 Reliability requirements

- A duplicate click, HTTP retry, reconnect, or delayed response must not double-spend wallet, duplicate material, award a project twice, or settle a trade twice.
- A project winner must be deterministic, auditable, and impossible to override through client timing.
- A server restart must not lose pending project schedules, transports, processing jobs, health mission deadlines, trade expiries, or durable events.
- A temporary socket disconnect must not lose canonical state. The player sees reconnecting status and the client retrieves snapshot if recovery is incomplete.
- A delayed or failed animation must never change game state.
- An admin action must be auditable with actor, timestamp, before/after state, and reason when supplied.

### 16.2 Security requirements

- Authenticate HTTP and Socket.IO through a consistent token/session model.
- Authorize every command against user, team membership, selected role, game status, and target entity ownership.
- Rate limit login, commands, chat, chatbot, joins, and admin actions separately.
- Validate all untrusted input with Zod; sanitize markdown/chat output; use safe rendering in frontend.
- Do not trust role, wallet, resource amount, server timestamp, game id, or team id from client payload without server lookup.
- Use HTTPS/WSS, secure cookies/token storage strategy, Helmet/CORS protections, Mongo/Redis private networks, least-privilege credentials, secrets manager, and audit logs.
- Store password hashes only for private rooms; never broadcast them.
- Apply spam/flood controls and abuse-reporting to chat.
- Include role checks in chatbot data retrieval and log which game-state context was provided to the model.

### 16.3 Performance targets

Initial target capacity: one room with 30 teams / 90 students, several concurrent class rooms, and ordinary institutional web traffic.

Suggested service objectives:

| Metric | Target |
|---|---:|
| Standard command p95 API latency | under 300 ms excluding client network |
| Project claim settlement p95 | under 750 ms |
| Realtime event fanout after commit p95 | under 500 ms |
| Snapshot API p95 | under 500 ms for one team view |
| Scheduler lateness | under 1 second under expected load |
| Lost/duplicated settled command | zero tolerated |
| Full room reconnect recovery | canonical snapshot within 3 seconds under normal connection |

### 16.4 Load-control rules

- Broadcast team-private changes only to the relevant team room; do not broadcast every inventory change to all 90 players.
- Broadcast global project status to the game room.
- Publish room leaderboard summary at bounded intervals, for example every 5 seconds, not after every click.
- Use a maximum active-project count and bounded trade/chat offers.
- Avoid polling during active game except low-frequency reconnect fallback; websockets handle normal state updates.
- Paginate/filter historical activity and admin data; do not load full activity logs into active game pages.
- Store compact state, move large immutable histories to append-only collections, and avoid unbounded arrays in Mongo documents.
- Use indexes derived from real query patterns and inspect query plans/load test results before adding indexes indiscriminately.

## 17. Testing and Validation Plan

### 17.1 Unit tests: pure engine

Required tests include:

- CO2 multiplier boundaries, average calculation, and rounding.
- Wallet accounting and ranking/tie-breakers.
- Material recovery output, contamination, residue, landfill, and external-purchase rules.
- Health mission creation, correct/incorrect step outcomes, expiry, and critical-state behavior.
- Project readiness and claim eligibility.
- Project claim winner invariants under repeated/exactly identical commands.
- Trade offer validation, resource locking, expiration, countering, accepting, and settlement.
- Role authorization policy.
- Deterministic schedule generation from seed.

### 17.2 Integration tests: API and MongoDB

- Create/join complete team, assign roles, and enter/start a two-team room.
- All game command endpoints with valid role, invalid role, stale revision, and duplicate idempotency key.
- Two simultaneous project claims from different teams; exactly one winner and no missing/duplicate inventory.
- Two simultaneous accept/cancel/expiry operations on a trade; exactly one valid outcome.
- Worker restart during due project/health/trade/transport events.
- Outbox delivery retry and no duplicate client event publication.
- Administrator pause/resume/end controls and audit event creation.

### 17.3 End-to-end tests: Playwright

- New-student onboarding and accessible keyboard path.
- Team leader/team member role-selection synchronization.
- Game room start countdown and role routing.
- Municipality -> MRF -> Broker -> project claim full loop.
- Trade negotiation and delivery animation/state reconciliation.
- Health mission parallel completion.
- Project winner and losing-team plan release.
- Socket disconnect/reconnect and snapshot reconciliation.
- Results/debrief and admin monitor.

### 17.4 Concurrency and load tests

Use k6 or Artillery with realistic command distribution:

- 90 connected players in a 30-team room.
- Multiple rooms start at nearly the same time.
- 30 near-simultaneous attempts to claim one project.
- Trade-offer bursts and chat/ping rate-limit behavior.
- Worker catch-up after a deliberate 5 to 15 second pause.
- Reconnect storm after network interruption.
- Verify p95 targets and zero invariant violations, not merely HTTP success rate.

### 17.5 Playtest and learning validation

Before broad release, run staged playtests:

1. Internal usability playtest with two teams.
2. Faculty/content expert validation of every project/mission explanation and economic simplification.
3. Accessibility test with keyboard, screen reader, reduced-motion, low-bandwidth, and disabled student participants.
4. Small university pilot with observation, survey, event analysis, and debrief interviews.
5. Larger classroom pilot at target room size.

Measure:

- project completion and backlog;
- role active/blocked time;
- wallet/CO2/health distribution;
- reliance on external purchasing versus recovery/trade;
- side-mission completion rate;
- communication distribution;
- student understanding before/after;
- perceived fairness, cognitive load, and accessibility issues;
- error/reconnect/failure telemetry.

## 18. Implementation Delivery Plan

### Phase 0: Product and content lock

- Confirm game duration, max teams, room-owner/facilitator policy, ranking tie-breakers, health threshold, score display, external-market model, and trading fairness mode.
- Have circular-economy subject experts validate material assumptions, project templates, mission content, and terminology.
- Produce visual style guide, original asset brief, and accessibility acceptance checklist.
- Create architecture decision records for monorepo, state model, command/realtime boundary, scheduler, and data retention.

**Exit criteria:** signed-off game design specification and at least 12 project templates plus 6 health mission templates authored in configuration form.

### Phase 1: New platform foundation

- Initialize monorepo, shared TypeScript config, linting, formatting, CI, environment validation, Docker local development.
- Implement authentication/profile, users, teams, role selection, rooms, and facilitator start flow.
- Add shared contracts and API error/idempotency middleware.
- Set up MongoDB schema/index migrations, Redis, Socket.IO authentication/room membership, structured logging, and baseline metrics.

**Exit criteria:** three players can form a team, select unique roles, join a room, and start a dummy game with reliable reconnect behavior.

### Phase 2: Authoritative game shell

- Implement `Game`, `GameTeamState`, scheduler lease, snapshots, outbox, and event publisher.
- Build pure game-engine command transitions and deterministic scenario/seed system.
- Build shared Game Shell, Project Rail, Team Operations panel, metrics header, semantic event/animation infrastructure, and team chat/pings.
- Implement project scheduler/activation/expiry and atomic project claim without material production yet.

**Exit criteria:** two teams can see the same project schedule, complete readiness states, race for a project, and receive exactly one correct winner.

### Phase 3: Three-role material loop

- Implement Municipality waste source/route/transport actions.
- Implement MRF queue, process modes, recovery/residue effects, project certification.
- Implement Broker demand board and external wholesaler.
- Implement material inventory, project planning, role readiness, project consumption, and CO2 multiplier.

**Exit criteria:** every successful project requires an observable contribution from all three roles and produces correct wallet/CO2/health state changes.

### Phase 4: Health missions and trading

- Implement health mission scheduler, role steps, outcomes, critical health state, and visual panel.
- Implement broker trade offers, reservations, negotiation thread, atomic acceptance, transport settlement, expiry, and audit history.
- Add facilitator visibility/controls for both systems.

**Exit criteria:** teams can choose between a global project, health mission, recovery, external purchase, and trade without data inconsistency or UI ambiguity.

### Phase 5: Chatbot, results, and analytics

- Migrate/rebuild chatbot knowledge base with new game documentation, authorization boundaries, rate limits, and context policy.
- Build results, debrief timeline, material-flow summary, individual private contribution summary, and facilitator investigation dashboard.
- Implement activity event projection/export and retention controls.

**Exit criteria:** a facilitator can reconstruct why a team won/lost wallet value and students receive understandable circular-economy feedback.

### Phase 6: Hardening and release

- Complete unit/integration/E2E/load/accessibility suites.
- Run security review, privacy review, content/faculty validation, and pilot classes.
- Balance project cadence, rewards, CO2 coefficients, side-mission pressure, and external/trade economics using recorded data.
- Prepare deployment runbook, alerting, incident response, support guide, and rollback plan.

**Exit criteria:** performance targets met at target capacity; no known duplicate-settlement/concurrency defects; faculty and accessibility sign-off complete.

## 19. Explicit Non-Goals for Version 1

To protect reliability and a timely build, do not add these until the core loop has been accepted:

- Full 3D multiplayer avatar movement or physics simulation.
- Frame-by-frame server synchronization.
- Arbitrary open global voice chat.
- Auction/bidding system.
- Player-to-player direct wallet transfers without a trade contract.
- User-generated project rules or unreviewed educational content in active matches.
- AI agent actions that can spend wallet, trade, collect, process, or submit projects.
- Large narrative campaign, achievements/streaks, loot boxes, or retention mechanics that distract from learning.
- Forced daily engagement or punitive social mechanics.

## 20. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Project race rewards raw network speed over learning | Use visible planning/readiness conditions, server timestamp, configurable project windows, low-pressure tutorial, and accessibility mode; validate with playtests |
| One role becomes a bottleneck or idle | Instrument active/blocked time, retain parallel health/support actions, cap project complexity, and rebalance from data |
| Teams ignore health missions to maximize wallet | Make health affect project-claim eligibility and show future-cost consequences; balance mission rewards/pressure through tests |
| Teams exploit free trades/collude | Default to consideration-required trade, offer caps, reference-value guardrails, transparent audit history, facilitator monitoring |
| High CO2 multiplier feels arbitrary | Display formula, qualitative room comparison, before/after receipt, and use a gradual floor rather than a cliff |
| Double project win/trade settlement under load | Conditional state transitions, idempotency keys, short Mongo transactions, durable outbox, race-condition tests |
| Socket outage causes stale UI | Treat REST snapshot as canonical, version all events, reconnect/reconcile, never use socket as sole source of truth |
| Mongo documents grow unbounded | Keep mutable state compact; store event history in append-only collection; archive finished work records |
| Animation harms accessibility/performance | Semantic state always visible; transform-only animation; reduced-motion mode; no game logic tied to animation |
| Chatbot leaks team data or hallucinates | Strict authorization context, no action tools, approved RAG content, clear uncertainty, prompt/response policy |
| Scope exceeds schedule | Deliver in phases; keep worker/modular-monolith design; defer 3D/voice/complex AI and extra materials |

## 21. Research and Design Basis

The following sources informed the collaboration, accessibility, usability, and architecture recommendations. They should guide implementation decisions, not replace content-expert validation or user research.

1. Carnegie Mellon University Eberly Center, *Best Practices for Designing Group Projects*. Supports positive interdependence, explicit teamwork guidance, and individual accountability. https://www.cmu.edu/teaching/designteach/design/instructionalstrategies/groupprojects/design.html
2. CAST, *Universal Design for Learning Guidelines 3.0*. Supports multiple means of engagement, collaboration, representation, action, communication, and reflection. https://udlguidelines.cast.org/
3. W3C, *Web Content Accessibility Guidelines 2.2*. Supports accessible operation, timing adjustment, focus, dragging alternatives, target size, understandable feedback, and robust semantics. https://www.w3.org/TR/WCAG22/
4. Game Accessibility Guidelines, *Full List*. Supports adjustable speed, simplified alternatives, no repeated inputs, non-color-only information, visual multiplayer communication, text/voice alternatives, and reduced cognitive load. https://gameaccessibilityguidelines.com/full-list/
5. Nielsen Norman Group, *10 Usability Heuristics for User Interface Design*. Supports visible system status, user control, error prevention/recovery, recognition over recall, and contextual help. https://www.nngroup.com/articles/ten-usability-heuristics/
6. Hunicke, LeBlanc, and Zubek, *MDA: A Formal Approach to Game Design and Game Research*. Supports separating mechanics, player dynamics, and intended experience when balancing a game. https://www.cs.northwestern.edu/~hunicke/MDA.pdf
7. Socket.IO documentation, *Redis Adapter* and *Connection State Recovery*. Supports multi-node room broadcast, Redis infrastructure security, sticky sessions, and canonical state resynchronization after reconnect. https://socket.io/docs/v4/redis-adapter/ and https://socket.io/docs/v4/connection-state-recovery/
8. MongoDB documentation, *Transactions* and *Compound Indexes*. Supports atomic multi-document settlement only where needed and query-pattern-led indexing. https://www.mongodb.com/docs/manual/core/transactions/ and https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/

## 22. Final Build Directive

The implementation agent must build the new platform as an original, server-authoritative, modular circular-city game. The experience should feel energetic because the team manages visible, overlapping civic project opportunities and meaningful material/health trade-offs, not because it asks students to click rapidly or memorize hidden rules.

Prioritize, in this order:

1. Correct, atomic state transitions and reliable recovery.
2. Clear three-role interdependence and circular-economy learning value.
3. A readable, attractive, animated, accessible interface.
4. Instructor/facilitator visibility and durable activity records.
5. Configurable content and metrics for future balancing/expansion.

Do not carry forward the legacy auction system, duplicated multi-team game state, random Team A/B pairing assumptions, or undocumented formula conflicts from the old Besse platform.
