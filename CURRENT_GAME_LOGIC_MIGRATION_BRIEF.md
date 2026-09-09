# Current Game Logic Migration Brief

## Purpose

This document consolidates the current Besse educational circular-economy game into a migration-ready product and game-design brief. It is intended to support replacement of the current platform with a new game mechanism and UI/UX without losing the learning model, core role dependencies, economic decisions, or valuable operational rules.

**Important reading rule:** the codebase has evolved through multiple design versions. Where sources conflict, this document identifies the conflict instead of silently selecting a rule. Treat the **current backend implementation** as the best source for what runs today; treat player-facing and legacy manuals as product intent that needs confirmation during redesign.

## Product Summary

| Item | Current understanding |
|---|---|
| Working title | Clash of the Cities - Mission Net Zero / Besse |
| Audience | University students learning circular economy concepts through multiplayer play |
| Learning premise | A city should keep material value in circulation, rather than allowing waste, delays, contamination, and landfill dependence to destabilize the system |
| Team structure | Three students form one city team: Municipality, MRF, and Broker |
| Competitive structure | Current implementation supports 2 to 30 city teams in a room; teams share a marketplace and are ranked against one another |
| Core tension | Deliver projects and earn score while preserving budget and city health and controlling emissions |
| Current primary ranking measure | Cumulative score from completed municipality projects |
| Failure measures | City health and budget can eliminate a team; CO2 increases operational pressure but does not directly rank teams |

## Learning Outcomes To Preserve

The replacement game should continue to teach the following system relationships, even if it changes all screens and interaction patterns.

1. **Waste hierarchy:** avoid backlog, recover materials, reuse materials in civic projects, trade strategically, and use landfill only as a last resort.
2. **Interdependence:** no role can succeed alone. Municipality creates demand and manages incoming waste, MRF creates usable supply, and Broker turns the market into project-ready materials.
3. **Trade-offs:** speed costs more; logistics create emissions; landfill clears pressure but destroys material value and increases environmental cost; external buying is reliable but expensive.
4. **Material quality and value:** recovered material is not equally valuable. Sorting/quality choices influence the market route and value recovery.
5. **Systems thinking:** strong performance balances economic, environmental, and operational outcomes rather than optimizing a single number.
6. **Market competition:** teams can compete for limited or desirable materials, requiring prioritization and communication.

## Current End-to-End Player Flow

### 1. Account and team formation

1. A player registers/logs in and creates or joins a three-player lobby.
2. A lobby has a six-character code and holds exactly three players.
3. The lobby leader advances the group from the waiting room to role selection.
4. Players select Municipality, MRF, and Broker on a first-available basis. A role cannot be held by two people; a player may deselect their own role.
5. The team becomes ready only when all three unique roles are assigned.

### 2. Matchmaking and room assembly

1. A ready team enters the Matchmaking Lobby.
2. The active UI lets a team leader join an existing room. The user interface currently tells students that administrators create rooms.
3. A room can hold up to 30 teams, each displayed as a city slot containing three seats.
4. Teams enter together and are assigned the first available city slot from 1 through 30.
5. The room page updates by websocket plus polling. A leader can remove their team before the room starts.
6. At least two teams are required to start.
7. The active backend and UI currently allow **only an administrator** to start any room. Once started, each participant is routed to the page for their role.

### 3. Match start and shared state

1. Starting creates one multi-team `GameState` containing all teams in the room.
2. Each team receives independent city resources and timers but participates in the same room-wide auction market.
3. The same authoritative game state is copied into a `GameSession` document for every team session.
4. Every team starts with one randomly generated waste batch.
5. All actions and timed checks publish game-state updates over Socket.IO/websockets.

### 4. Per-team play loop

```text
Waste appears in Municipality queue
  -> Municipality transports it to MRF or rejects it to landfill
  -> MRF processes it, landfills it, or later returns recovered material to Municipality
  -> MRF may list recovered material in the room-wide auction market
  -> Broker bids on other teams' material or buys from an external wholesaler
  -> Purchased/returned material enters Municipality inventory
  -> Municipality contributes material to city projects
  -> Completed projects improve city state and add competitive score
  -> Timed system checks add waste, finish transports, resolve auctions, apply overdue penalties, and end/eliminate teams
```

## Role Responsibilities And Decisions

### Municipality: city operations, logistics, and projects

**Player purpose:** prevent uncollected waste from becoming a city-health crisis and turn recovered material into visible city projects.

**Current actions**

| Action | Inputs | Immediate result | Learning decision |
|---|---|---|---|
| Collect and transport waste | Waste batch; fast or slow mode | Deducts transport cost, adds one transport trip's CO2, then puts the batch in transit to the MRF | Pay for speed to avoid backlog or save cash and risk delay |
| Reject waste | Pending waste batch | Sends it to landfill; adds landfill CO2; marks the batch failed | Clear pressure quickly at high environmental cost and with no material recovery |
| Contribute project materials | Project, material type, and quantity | Consumes Municipality inventory, adds project-build CO2, and increases project progress | Allocate scarce material between current projects and future priorities |
| Complete project | Automatic when all required materials have been contributed | Adds health, budget reward, and project score | Coordinate upstream roles around project material requirements |

**Transport modes currently implemented**

| Mode | Cost | Travel time | CO2 |
|---|---:|---:|---:|
| Fast | $50 per ton | 20 seconds | +1.6 tCO2 per trip |
| Slow | $25 per ton | 40 seconds | +1.6 tCO2 per trip |

### MRF: sorting, recovery, quality, disposal, and return logistics

**Player purpose:** transform mixed waste into reusable material, decide when recovery is worthwhile, and expose the material to a market or return it directly to their city.

**Current actions**

| Action | Inputs | Immediate result | Learning decision |
|---|---|---|---|
| Process waste | MRF queue item | Converts each material portion using material process rates; pays disposal fee for refuse; adds processing and landfill CO2; creates pending material-auction lots | Recover value instead of landfill while accepting processing/refuse costs |
| Send batch directly to landfill | MRF queue item | Removes the batch; charges a reduced disposal estimate and reduced landfill CO2 compared with standard disposal | Use a fallback to prevent queue pressure, while sacrificing circular value |
| Assign quality and entry price | Pending auction; grade A/B/C/F; custom starting price | A/B/C activates a 30-second auction; F disposes of the lot to landfill | Balance quality/value expectations with likelihood of a sale |
| Return material to Municipality | Pending recovered-material auction; fast/slow mode | Removes the pending lot, charges transport, and delivers mass to municipal inventory when transport completes | Keep recovered material for own projects instead of exposing it to competition |

### Broker: market acquisition and team purchasing strategy

**Player purpose:** obtain project materials at a sensible cost while using the market to generate income from materials produced by their team.

**Current actions**

| Action | Inputs | Immediate result | Learning decision |
|---|---|---|---|
| Bid on global auction | Auction lot | Raises bid by 5% of entry price and makes the team highest bidder if it has sufficient budget | Decide when competitive material is worth escalating cost |
| Buy external material | Material type and quantity | Deducts purchase cost and adds mass directly to Municipality inventory | Pay a predictable premium to avoid market uncertainty |
| Monitor market | All room auction listings | Shows seller city, current bid, high bidder, end time, and material details | Plan around opponents, timing, and project shortages |

## Resources, State, And Material Flow

### Team state that matters for migration

- Budget/wallet
- City health
- Total CO2
- Total project score
- Waste batches and pending waste mass
- MRF processing queue
- Active transports
- Municipality material inventory
- Pending/active/sold marketplace listings
- External-wholesaler stock
- Project state and contributed material progress
- Team status: active, completed, or eliminated
- Activity log and action history used for player feedback

### Material types

| Material | Base price per ton | Processing recovery rate | Waste/refuse rate | Project-use CO2 per ton |
|---|---:|---:|---:|---:|
| Paper | $180 | 85% | 15% | 0.8 |
| Plastic | $350 | 80% | 20% | 2.5 |
| Metal | $600 | 90% | 10% | 1.5 |
| Glass | $120 | 75% | 25% | 0.6 |
| Wood | $100 | 90% | 10% | 0.3 |

### Waste generation

- A team begins with one batch and receives another approximately every 30 seconds.
- Batch mass is random from 10.0 to 25.0 tons.
- A batch becomes overdue after two minutes if it remains `PENDING`.
- Each batch is penalized once when overdue: -7 city health.
- Origins and fixed compositions are:

| Origin | Composition |
|---|---|
| Residential | 50% paper, 30% plastic, 20% glass |
| Commercial | 40% paper, 40% plastic, 20% metal |
| Industrial | 40% plastic, 30% metal, 30% wood |

### Circular paths represented today

```text
Preferred internal loop
Municipal waste -> transport -> MRF recovery -> direct material return -> Municipality project

Market-enabled loop
Municipal waste -> MRF recovery -> auction -> another team's Municipality project

Fallback paths
Municipal pending waste -> direct landfill
MRF queue batch -> direct landfill
MRF processing refuse -> landfill
Grade F recovered material -> landfill
```

## Core Rules And Calculations In Active Code

### Start and timing

| Rule | Active implementation |
|---|---:|
| Starting budget | $20,000 per team |
| Starting health | 60 per team |
| Starting CO2 | 0 |
| Team match duration | 15 real-time minutes |
| Waste spawn interval | 0.5 real-time minutes |
| System-check / autosave target | 30 seconds |
| Auction duration | 30 seconds |
| Auction bid increment | 5% of entry price on each bid |
| External wholesaler markup | 2x base material price |

### Cost and environmental equations

```text
Municipality transport cost = batch mass * mode cost per ton
Transport CO2 = transport trips * 1.6

Recovered output for each material = batch mass * material composition * material process rate
Refuse mass = batch mass - sum(recovered output)
Processing disposal fee = refuse mass * $50
Processing CO2 = batch mass * 0.015
Processing refuse CO2 = refuse mass * 2.5

Municipality reject-to-landfill CO2 = batch mass * 2.5
MRF direct-landfill fee = estimated processing disposal fee * 0.70
MRF direct-landfill CO2 = batch mass * 2.5 * 0.50

Project contribution CO2 = contributed material mass * material-specific project-use CO2
External purchase cost = base price * 2 * requested mass
```

### Project completion

- Municipality projects are independently available in the current implementation; there is no enforced sequential unlock chain.
- A project accepts partial material contributions.
- On full contribution, it is marked complete, consumes the submitted materials, adds its health and budget rewards, and adds its score to the team total.
- The active game initializes 14 projects, from small neighborhood improvements to the Eco Market & Circular Trade Hall.
- Project score is dynamically derived at game creation, not treated as a fixed authored value in the service:

```text
estimated external cost = sum(required material quantity * internal material cost weight)
difficulty score = round(total required quantity + estimated external cost / 180)
project score = max(8, round(difficulty score * 1.35))
```

The 14 project names and material requirements in `docs/game_documentation.txt` are useful reusable content, but exact reward and score values must be revalidated against the active generator before migration.

### Auctions

1. MRF processing creates a pending auction lot for each recovered material type; pending lots of the same type can aggregate mass.
2. The MRF chooses A/B/C/F and a custom entry price.
3. A/B/C creates a public 30-second room-wide auction. F disposes of the material.
4. A team cannot bid on an auction listed by the same team.
5. A bid raises the current price by `entry price * 0.05`; the bidder must have that amount available at bid time.
6. At expiry, the buyer pays the final bid, receives the material in Municipality inventory, and the seller receives 90%; the marketplace retains 10% as a fee.
7. If there is no valid winning bidder, the active implementation returns the lot to `pending` MRF material rather than liquidating it.

## Win, Elimination, And Ranking

### Elimination

- A team is eliminated immediately when city health reaches 0 or lower.
- A team with negative budget is eliminated only if it has no material inventory, no market listings, and no pending waste inventory.
- The legacy countdown/recovery model is documented but is not the active elimination behavior in `GameService`.

### Match completion

- A team's run completes when its 15-minute timer expires.
- The room game completes when all teams have completed or been eliminated, or when one active team remains after other teams are eliminated.
- Individual game result records are persisted per player/role at room completion.

### Ranking

- Teams are sorted descending by total completed-project score.
- Budget, health, and CO2 are displayed in result data but do not enter the current sorting formula.
- No explicit tie-breaker is implemented; equal scores retain the sort's natural order.

## Current Experience And Technical Delivery

### Main player pages

| Stage | Primary frontend page |
|---|---|
| Team lobby and role choice | `Besse-frontend/app/dashboard/role/page.tsx` |
| Matchmaking room list | `Besse-frontend/app/dashboard/matchmaking-lobby/page.tsx` |
| Room seating and start wait | `Besse-frontend/app/dashboard/game-room/[roomCode]/page.tsx` |
| Municipality play | `Besse-frontend/app/dashboard/municipality/page.tsx` |
| MRF play | `Besse-frontend/app/dashboard/mrf-collection/page.tsx` |
| Broker play | `Besse-frontend/app/dashboard/broker-inventory/page.tsx` |
| End/result state | `Besse-frontend/app/dashboard/game-over/page.tsx` |

### Realtime behavior worth preserving conceptually

- Pages fetch initial state, then reconcile websocket game-state events.
- The room uses both periodic polling and websocket room events to recover from missed events.
- System checks complete in-flight transports, spawn waste, apply overdue penalties, update timers, and determine completion/elimination.
- Auction expiry is handled by a backend scheduler, rather than fragile per-browser timers.
- The platform includes an in-game help/chatbot and teammate chat capability; these are optional supporting features, not part of the economic game loop.

## Source-Of-Truth And Migration Risks

The following differences are essential inputs to redesign planning. They should be resolved into a single game-design specification before implementation begins.

| Topic | Active implementation | Documentation/design intent | Migration recommendation |
|---|---|---|---|
| Room creator and starter | All create/start endpoints are admin-protected; frontend says administrators create rooms and start games | New-flow documents say a normal room leader can create/start and ownership transfers when the owner leaves | Confirm desired facilitator model: admin-controlled classroom sessions or student-led rooms |
| Private-room password | Backend enforces only minimum length 6 | Design says letters/numbers only | Specify validation, privacy, and discovery behavior explicitly |
| Legacy pairing | Old in-memory random Team A/B pairing code remains in `lobbyService.ts` | New room model replaces it | Exclude from replacement unless a two-team classroom mode is deliberately retained |
| Starting values and duration | $20,000, health 60, 15 minutes | Older manual says $10,000, health 100, 30 minutes; public guide agrees with $20,000/60/15 | Use active values only after balancing review; do not migrate legacy values accidentally |
| Health model | Active checks apply overdue-batch health loss; direct actions/projects also change health | Manuals describe additional aggregate waste-over-100 and CO2-over-200 health penalties plus a game-over countdown | Decide which pressure model is pedagogically clearer and implement it once |
| Landfill economics | Municipality rejection adds CO2 but no explicit dumping fee; MRF direct landfill uses reduced factors | Documents describe standard landfill fee and different related values | Define a single landfill cost/impact model and make all paths consistent |
| External wholesaler markup | 2x base price | Legacy manual says 2.5x; current public guide says 2x | Confirm intended scarcity and fallback cost |
| Auction no-bid result | Returns the lot to pending MRF material | Legacy manual says liquidation at half value | Decide whether failure should create a retry, scrap, or automatic liquidation lesson |
| Bid cap | Constant declares 10 active bids, but `placeBid` does not enforce it | Legacy manual describes a 10-bid cap | Either implement and explain it, or remove it from the redesigned rules |
| Quality multiplier | Constants define A/B/C multipliers, but auction settlement uses MRF's manually supplied entry price rather than calculating price from grade | Player documentation presents grade-based value formula | Clarify whether grade should change price mechanically, influence demand, or be a qualitative learning signal |
| Projects | Current service supports 14 projects and partial contributions; all projects start available | Legacy manual has four sequential projects; public guide gives fixed 14-project score values | Retain the 14-project content as a candidate library, then define project visibility, timing, prerequisites, and authored scores intentionally |
| Score | Active code calculates score from material burden via internal weights | Public documentation lists fixed score rewards | Use an explicit, visible, deterministic score table in the new design unless dynamic scoring is a learning objective |
| State persistence | A shared game state is duplicated across one `GameSession` per team | Design calls for more normalized room, membership, results, and dynamic-team records | Rebuild around one authoritative room/match state to avoid synchronization and concurrency complexity |

## Reusable Content Assets

The following can be reused even if all UI and mechanics are redesigned.

- Three-role learning model: Municipality, MRF, Broker.
- Five material types and their environmental/economic profiles.
- Waste-origin scenarios: residential, commercial, industrial.
- The preferred circular flow and last-resort landfill flow.
- Fast-versus-slow logistics trade-off.
- Quality/contamination as a recovery-value concept.
- Project library of 14 civic/circular-economy improvements.
- Shared, visible city indicators: budget, health, CO2, score, waste backlog, project progress.
- Room-based classroom structure for 2 to 30 teams and an administrator/facilitator monitor.
- Multi-team market competition as a social learning mechanic.

## Suggested Redesign Principles

1. **Keep the causal chain visible.** Students should always understand how a decision moves material and affects money, city resilience, emissions, and project progress.
2. **Reduce hidden accounting.** Use a small, fully consistent rule set and show predicted consequences before irreversible actions.
3. **Make collaboration central.** Build mechanics that require explicit handoffs and shared planning, rather than three disconnected role dashboards.
4. **Use projects as meaningful goals.** Projects should communicate real circular-economy outcomes and create clear strategic priorities.
5. **Keep competition constructive.** Auction and ranking should reward circular performance without making other teams' failure the only viable strategy.
6. **Design for a classroom facilitation rhythm.** Support a clear start, short rounds/chapters, pauses or debriefs, live monitoring, and an explainable final result.
7. **Separate educational design from legacy technical constraints.** Do not preserve duplicated game state, stale pairing logic, or UI-specific data structures solely because they exist today.

## Decisions Required Before Building The Replacement

The following product decisions should be confirmed in the discovery/design phase before a new platform is implemented.

1. Is the new experience synchronous live multiplayer, turn/round-based classroom play, asynchronous team play, or a hybrid?
2. Should all three team roles remain separate player roles, or should students rotate roles during the session?
3. Is the teacher/admin the only match host and starter, or should a student team leader host normal rooms?
4. What is the desired session duration, number of rounds, and debrief time for a university class?
5. Which outcomes should determine ranking: project score only, a transparent composite sustainability score, or a non-competitive learning assessment?
6. Should landfill be a selectable emergency action, a consequence of inaction, or both?
7. Should the market be an open real-time auction, a simpler contract/trade system, a fixed periodic market, or a new mechanism entirely?
8. Should material quality be player-controlled, generated by sorting decisions, or represented by contamination/technology choices?
9. Should external purchasing remain available? If so, should it be unlimited, scarce, or tied to ethical/sustainability consequences?
10. Which project themes, local municipal contexts, and learning outcomes should be tailored to the target university course?
11. What should students see during play versus only in a post-game debrief, especially regarding other teams' data?
12. What evidence of learning is needed: score only, a reflection screen, action history, instructor analytics, or assessment export?

## Key Code And Documentation References

| Area | Primary reference |
|---|---|
| Current player-facing rules and project content | `Besse-backend/docs/game_documentation.txt` |
| Active constants | `Besse-backend/src/constants/constants.ts` |
| Match creation, score, system checks, elimination, ranking | `Besse-backend/src/services/gameService.ts` |
| Municipality actions | `Besse-backend/src/services/municipalityService.ts` |
| MRF actions | `Besse-backend/src/services/mrfService.ts` |
| Auction and wholesaler behavior | `Besse-backend/src/services/brokerService.ts` |
| Room lifecycle | `Besse-backend/src/services/matchmakingService.ts` |
| Lobby/role flow and retained legacy pairing | `Besse-backend/src/services/lobbyService.ts` |
| Current room UX | `Besse-frontend/app/dashboard/matchmaking-lobby/page.tsx`, `Besse-frontend/app/dashboard/game-room/[roomCode]/page.tsx` |
| Legacy historical design | `Besse-backend/GAME_LOGIC_MANUAL_V2.md` |
| Earlier new-flow plan | `new_game_flow_guideline.md` |
