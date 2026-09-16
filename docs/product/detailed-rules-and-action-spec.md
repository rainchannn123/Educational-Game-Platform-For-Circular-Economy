# Current Gameplay Rules And Action Specification

This document describes the implemented, server-authoritative baseline. It supersedes older planning text that required project-readiness gates or allowed direct recycling of mixed raw batches.

## 1. Match Structure

- A match lasts 20 minutes.
- Teams consist of Municipality, MRF, and Broker roles.
- All roles see the same team city, projects, shared inventory total, City Health, chat, announcements, and city leaderboard.
- Role-specific workspaces and inventory allocations are private to the team but distinct by role.
- Browser timers are display aids only. API commands and the worker decide every transition.

## 2. Material Vocabulary

The game uses five material types:

| Material | Primary visual color |
| --- | --- |
| Paper | Gold |
| Plastic | Cyan |
| Metal | Steel blue |
| Glass | Green |
| Wood | Copper |

Recovered material has a grade. Projects use eligible A/B grade stock; role pockets also maintain locks for active trade offers.

## 3. Waste Generation And Municipality Collection

### 3.1 Source scheduling

Each active city has a persisted waste schedule. The worker chooses a deterministic pseudo-random interval between 10 and 30 seconds for each city and attempts one new source when that interval is due. This gives each team independent timing while remaining reproducible and restart-safe.

A visible-source cap prevents unbounded build-up. A source contains total mass, contamination, expiration time, and a material composition map.

### 3.2 Municipality command

Only Municipality may submit:

```text
POST /v1/games/:gameId/municipality/collections
```

The command identifies one available raw source and one route: `express`, `standard`, or `consolidated`.

On acceptance, the server atomically verifies the role and team revision, charges transport cost/CO2, changes the source to `in_transit`, creates a `Transport` record, appends audit data, and writes a durable outbox event. It does not start MRF processing or change inventory.

At the persisted arrival time, the worker changes the transport to `arrived` and the linked source to `at_mrf` in one transaction. The batch then leaves Municipality operations and appears in MRF decomposition work.

### 3.3 Municipality restriction

Municipality cannot use the generic recovered-material transfer endpoint. Its logistics role is raw waste collection. It can view team and role inventory but only MRF and Broker can dispatch recovered material allocations.

## 4. MRF Decomposition And Recycling

### 4.1 Why there are two stages

An arrived source is mixed waste. A material-specific recycling method must not delete the other materials in the batch. Therefore the MRF workflow is always:

```text
at_mrf raw batch -> Decompose Waste -> held material streams -> recycle/dispose each stream
```

### 4.2 Decompose Waste

Only MRF may submit:

```text
POST /v1/games/:gameId/mrf/decompositions
```

The command accepts only an `at_mrf` raw source. It marks the raw parent as `decomposed` and creates one `held` child source for every non-zero material component. Child mass exactly matches the original component mass. No usable inventory is created during decomposition.

The parent remains associated with all child streams for auditability and MRF queue capacity. It becomes terminal only when all child streams are terminal.

### 4.3 Recycle or dispose a stream

Only MRF may submit:

```text
POST /v1/games/:gameId/mrf/processes
```

The command accepts a held single-material stream and one compatible method. The server calculates the receipt from stream mass, contamination, and the configured method; clients cannot submit output, grade, cost, or CO2 values.

The worker later settles the due job in a transaction. Recycling credits output to shared inventory and the MRF role allocation. It records recovery, residue, CO2, health, provenance, stream completion, parent completion when appropriate, and a durable event together.

## 5. Shared Inventory And Role Allocations

The game deliberately distinguishes two ledgers:

| Ledger | Meaning | Project eligible? | Transferable by |
| --- | --- | --- | --- |
| Shared inventory | Total city material across the team | Yes | Not directly transferred |
| Role inventory | Material currently allocated to Municipality, MRF, or Broker | Reconciled on claim | MRF and Broker only |

When the MRF recovers material, both ledgers increase: the shared total increases and the MRF allocation receives the same stock. A completed MRF/Broker material transfer decreases the sender allocation at departure and increases the recipient allocation at arrival; the shared total is unchanged because the material never leaves the team.

Material transfer endpoint:

```text
POST /v1/games/:gameId/material-transfers
```

The worker completes transfers transactionally with the destination allocation update and durable event. Municipality is rejected by the endpoint even if a client bypasses the UI.

## 6. Broker Workflow

Broker has an independent inventory tab and can:

- inspect Broker-held material and locks;
- transfer Broker allocations to MRF or Municipality;
- purchase external material, which credits shared inventory and Broker allocation;
- create, accept, reject, cancel, or receive trade offers;
- review trade and procurement effects on wallet and CO2.

Trade expiry releases locks from both shared inventory and the Broker role allocation. An expired trade must not permanently block later transfers or offers.

## 7. Projects And Rewards

Projects appear in the top project rail with requirements, timing, and reward information.

### 7.1 Who can claim

Only Municipality may submit:

```text
POST /v1/games/:gameId/projects/:projectId/claim
```

MRF and Broker project controls remain visible but disabled with `Waiting Muni's action`.

### 7.2 Material rule

Project requirements are validated against **shared inventory**. Stock does not need to be manually moved into Municipality allocation first.

On a successful claim, the authoritative transaction:

1. verifies Municipality role, project state, team revision, health, and shared grade eligibility;
2. consumes the required A/B material from shared inventory;
3. consumes the corresponding unlocked material from role allocations in a deterministic order;
4. awards the CO2-adjusted wallet result;
5. records the receipt, activity event, announcement, and durable outbox event.

This reconciliation prevents used material from remaining available for a later transfer or trade.

### 7.3 CO2 multiplier and rank

Project receipts use an authoritative 0.5x to 2.0x multiplier based on the team’s CO2 performance relative to the other teams in the current game. The leaderboard ranks cities by wallet balance, highest first, using city slot and team ID only as stable tie-breakers.

## 8. City Health Recovery

### 8.1 Role knowledge pop quizzes

The game opens the first role-specific pop quiz 30 seconds after active play begins, then opens another every 60 seconds. Each quiz remains answerable for 30 seconds.

- Municipality, MRF, and Broker each receive their own question and four answer choices.
- The quiz bank contains 30 supplied questions per role. Each city uses a deterministic shuffled deck, so it sees every template before repeating one.
- Correct, wrong, and no-response feedback uses the existing authoritative health-mission reward and penalty rules.
- The browser displays the question and feedback, but the API validates submitted choices and the worker settles unanswered missions after the deadline.
- After feedback, the popup closes until the next scheduled quiz.

Health is server-owned. If it reaches zero, the team enters a 30-second recovery lock. The server rejects ordinary team commands with `TEAM_HEALTH_RECOVERY` until the worker restores health to 20.

The client shows a large countdown overlay. Its display hides when the known deadline reaches zero even if a Socket.IO event is delayed; it continues snapshot polling until the worker’s authoritative restoration is visible.

## 9. Communication And Real-Time Updates

- Team chat is visible only to teammates.
- Global chat is visible to every player in the current game.
- Announcements are durable game events.
- The API snapshot is the recovery mechanism after a reconnect or an event gap.
- Socket.IO events are deduplicated by event ID and prompt snapshot invalidation; they are not a settlement channel.

## 10. Security And Consistency Rules

- Commands use authenticated role membership, Zod validation, command IDs, and expected revisions where team state changes.
- MongoDB transactions protect cross-document outcomes.
- Worker settlement uses conditional status guards so a due transport or job is applied once.
- The durable outbox publishes semantic events only after state is committed.
- Redis availability affects immediate Socket.IO publication, not canonical game-state correctness.
