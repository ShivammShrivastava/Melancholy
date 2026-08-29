# Dev-Craft — Conflict Scenarios

Three scripted offline-edit sequences. Your sync layer must handle all three. At judging, a
judge drives these on two devices (Objective 3, Test C).

## How these are run and passed

For each scenario:

1. Both devices start from the identical initial state, both **offline**.
2. Device A applies its edits, then device B applies its edits. Neither can see the other.
3. Reconnect **A first, then B**. Record the final state.
4. Reset to the initial state, replay both edit sets, then reconnect **B first, then A**.
   Record the final state.

**Pass requires both of:**

- **Determinism** — the two final states are identical. Reconnection order must not change the
  outcome.
- **No silent loss** — every edit either survives, is merged, or is *surfaced* to the operator
  as a conflict. An edit that vanishes with no trace is a failure.

**There is no single correct final state.** Last-write-wins with timestamps, an operation log,
CRDTs and a custom merge policy all converge differently and all are acceptable — the brief
says so explicitly. You are scored on whether your strategy is deterministic, loses nothing
silently, and is documented in your README and defensible under questioning.

State your policy *before* the judge runs the test. "We use LWW on scalar fields, keyed by
device-id to break timestamp ties" is a good answer. Discovering your behaviour live is not.

---

## Initial state (all three scenarios)

```json
{
  "order_id": "ORD-1042",
  "customer": "Meena aunty",
  "items": [
    {"item_id": "it-1", "description": "kurta",  "quantity": 2, "attributes": {"color": "navy blue", "chest": 40}},
    {"item_id": "it-2", "description": "pajama", "quantity": 1, "attributes": {"color": "cream", "waist": 34}}
  ],
  "due_date": "2026-09-05",
  "amount": 1200,
  "references_prior_order": false,
  "confidence": 1.0,
  "needs_clarification": false
}
```

`item_id` is a stable identifier supplied so that scenarios 2 and 3 refer to the same item on
both devices. Your internal model may differ; the judge only inspects observable order state.

---

## Scenario 1 — Disjoint field edits

Two devices edit fields that do not overlap. The easy case; a system that fails here fails
everything after it.

| Device | Local time | Edit |
|---|---|---|
| A | 10:12 | `due_date` → `"2026-09-08"` |
| B | 10:15 | `amount` → `1500` |

**Pass:** the converged state has `due_date = "2026-09-08"` **and** `amount = 1500`. Both
edits survive under both reconnection orders. Losing either — including "B reconnected last so
B's whole record wins" — is a failure.

---

## Scenario 2 — Concurrent edit to the same field

Both devices change the same scalar. There is no merge that preserves both values, so this
tests your policy, not your luck.

| Device | Local time | Edit |
|---|---|---|
| A | 11:03 | `items[it-1].quantity` → `3` |
| B | 11:03 | `items[it-1].quantity` → `5` |

Note the identical timestamp: your tie-break cannot be "later wins". It must be something
total and stable — device id, a Lamport counter, a site id in a CRDT.

**Pass:** either

- the converged `quantity` is the same value under both reconnection orders, and the losing
  edit is **surfaced** (a conflict flag, a pending-review queue, an audit entry the operator
  can see); or
- both values are retained and presented as a conflict for the operator to resolve.

**Fail:** the two reconnection orders give different quantities, or one edit disappears with
nothing shown to the operator.

---

## Scenario 3 — Delete versus update

The hard one. A removes an item; B edits that same item without knowing it is gone.

| Device | Local time | Edit |
|---|---|---|
| A | 14:20 | delete `items[it-2]` |
| B | 14:22 | `items[it-2].attributes.color` → `"black"` |
| B | 14:23 | `items[it-2].quantity` → `4` |

This is where naive implementations diverge: a plain field-merge resurrects a deleted item,
and a plain delete-wins silently discards two edits.

**Pass:** either

- the item stays deleted (tombstoned) **and** B's two edits are surfaced as discarded, so the
  operator can undo; or
- the item is resurrected with B's edits applied, **and** the deletion is surfaced.

Either policy is defensible. Both reconnection orders must produce the same result, and the
losing intent must be visible somewhere the operator can find it.

**Fail:** the item silently reappears with no record of the delete, the edits silently vanish
with no record, or the two reconnection orders disagree.

---

## What judges will ask

- What is your merge policy, in one sentence?
- What happens when two devices have identical timestamps?
- Where does an operator see a conflict that your system resolved automatically?
- Which of these three scenarios does your system handle worst, and why?

An honest "scenario 3 resurrects the item and we surface the delete in the activity log; we
know that is the wrong default for cancellations" scores better than a claim of full coverage.
