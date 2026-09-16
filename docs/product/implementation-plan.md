# Implementation Plan And Historical Decisions

## Purpose

This file records the product direction that led to the current implementation. For current behavior, use [Current Gameplay Rules And Action Specification](detailed-rules-and-action-spec.md). Earlier versions of this plan described project-readiness gates and direct raw-batch MRF processing; those approaches are not part of the implemented baseline.

## Implemented Baseline

1. A full-window shared city gives all team roles one visual operating context.
2. Municipality receives and transports raw mixed waste only.
3. MRF decomposes raw batches before applying material-specific recycling methods.
4. Recycling adds usable material to shared stock and the MRF allocation.
5. MRF and Broker can move their recovered/procured allocations to teammates.
6. Broker supports purchases and trade with lock-aware inventory.
7. Municipality alone completes projects from shared inventory.
8. City Health, CO2 multiplier, wallet rank, announcements, and chat make team trade-offs visible.
9. API transactions, worker due timestamps, and the durable outbox protect authoritative outcomes.

## Design Principles Retained

- Teach circular-economy trade-offs through visible consequences, not hidden calculations.
- Preserve a meaningful distinction between raw waste, work-in-progress material streams, recovered material, and project-ready shared stock.
- Keep all role actions useful without making every role capable of every command.
- Make speed, cost, emissions, contamination, grade, and health effects readable before a player commits.
- Allow reconnect recovery from snapshots rather than trusting local browser simulation.

## Future Enhancements

Future product work may add richer tutorials, more authored waste templates, larger project/debrief content, additional city art, facilitator analytics, and expanded end-to-end tests. Such work must preserve the current role and authority boundaries unless the gameplay rules are deliberately revised and documented.
