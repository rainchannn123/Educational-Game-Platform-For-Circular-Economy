# ADR 0001: Persisted authoritative state and outbox

The browser never settles money, inventory, CO2, health, projects, or trades. Mutable team state is one `GameTeamState` per game/team, global project cards are one `GameProject` per game, and per-team project work is normalized separately. Cross-document outcomes use Mongo transactions. Socket events are published from a durable outbox only after transaction commit. This prevents duplicated awards and supports reconnect snapshot recovery.
