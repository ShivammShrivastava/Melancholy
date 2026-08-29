# DevCraft — LLM Integration + Database Layer

Scope: message parsing (online LLM + offline rules fallback) and the Firestore
offline-persistent database layer. No frontend/UI in this folder — built by
a teammate, importing from `parse-message.js` and `order-service.js`.

## What's here

| File | Role |
|---|---|
| `lexicon.js` | Hand-extracted vocabulary tables — number words, item synonyms (incl. Devanagari), closed attribute vocab, canonical value mappings, vague-deadline phrases. Every value here was pulled directly from `messages_train.json`, not guessed. |
| `date-resolver.js` | Deterministic date resolution against `received_at` (DATASET_CARD.md §4). |
| `rules-parser.js` | The offline fallback — zero network, zero model weights. |
| `api/parse-message.js` | Vercel Serverless Function — the online path, calls **Qwen2.5-7B-Instruct** via a HuggingFace Inference Endpoint. Holds the API token server-side (required — a no-build-tool frontend has no safe place to keep secrets client-side). |
| `parse-message.js` | Routing entry point: tries the online path with an 8s timeout, falls back to `rules-parser.js` on any failure (offline, timeout, malformed response). |
| `firebase-config.js` / `firebase-init.js` | Firestore init with `persistentLocalCache()` — offline-first by construction. |
| `order-service.js` | CRUD + the four Objective 4 query functions, all running against the local cache only. |
| `test-parser.js` | Validates the rules parser against the official `score.py`. |

## LLM model

**Qwen/Qwen2.5-7B-Instruct**, via a dedicated HuggingFace Inference Endpoint
(not the free serverless Inference API — its cold-start/rate-limit behavior
is a bad fit for a live judging window). Set `HF_ENDPOINT_URL` and
`HF_API_TOKEN` as Vercel environment variables.

## Validated accuracy — offline rules parser

Run against the real `messages_train.json` (250 messages) with the official
`score.py`:

| Measure | Score | Weight |
|---|---|---|
| Field-level extraction | 0.742 | 60% |
| Date resolution | 0.924 | 20% |
| `needs_clarification` | 0.936 | 20% |
| **Test A total** | **0.817** | |

This is the **offline path's own accuracy**, achieved with zero network and
zero model weights — entirely regex/lookup-table driven. The online LLM path
should score higher on genuinely novel phrasing the rules don't cover, but
hasn't been benchmarked here since it requires a live HF endpoint.

Reproduce: `node test-parser.js messages_train.json pred.json`, then
`python score.py --gold messages_train.json --pred pred.json`.

## Known limitations (stated honestly, per the brief's own scoring notes)

- **Item/attribute disambiguation for two specific words is heuristic, not
  general.** "roti" and "motor" are sometimes independent items and
  sometimes attributes of a neighboring item (`roti_count`, `appliance`).
  `mergeAmbiguousStandaloneWords()` in `rules-parser.js` handles the two
  cases observed in training data via a targeted post-process merge — a
  genuinely novel ambiguous word in the held-out set would not be caught by
  this and would likely be mis-split into an extra item.
- **Negation handling is clause-level, not a full parser.** It splits on
  sentence/comma boundaries and drops any clause containing "nahi" unless it
  contains a protected boolean-attribute keyword (jain/egg/ande). This
  correctly handles every negation pattern seen in training data, but a
  negation phrased differently in the test set (e.g. spanning more than one
  comma-delimited clause) could be missed.
- **Devanagari coverage is enumerated, not transliterated.** `lexicon.js`
  maps the ~25 distinct Devanagari item words actually observed in training
  data to their canonical forms. A Devanagari item word that never appeared
  in training (but appears in the held-out 50) will not be recognized by the
  offline path — this is the single biggest scaling risk for Test A if the
  held-out set's "different stylistic register" (per DATASET_CARD.md)
  introduces new Devanagari vocabulary.
- **Customer name extraction is pattern-based** (a small set of regexes
  keyed on "X ke liye", "X ka order", etc.) and will miss phrasings outside
  those patterns.
- **The online LLM path (`api/parse-message.js`) has not been benchmarked
  against `score.py`** in this repo — it requires a live, funded HF
  endpoint, which wasn't available during this build. The prompt encodes
  every rule from DATASET_CARD.md, but its actual accuracy on held-out data
  is unverified. Test it before relying on it for the live demo.
- **`getDeviceId()` in `order-service.js` uses `localStorage`** as a stable
  per-install ID. The sync layer uses this value as the deterministic
  tie-break for Scenario 2 (identical-timestamp conflicts) — the
  lexicographically higher `device_id` wins.

## Sync / conflict-resolution policy (Objective 3)

**One-sentence summary:** Field-level last-write-wins keyed on
`last_modified` timestamp, with lexicographically-higher `device_id` winning
ties; delete-vs-update is resolved by tombstoning the deletion and surfacing
the discarded edits in a `conflict_log` array on the order document.

### How it works

| Scenario | Policy |
|---|---|
| **Disjoint field edits** (Scenario 1) | Field-level merge: each field takes the version from whichever edit has the later `last_modified`. Since edits are to different fields, both survive. |
| **Same field, identical timestamp** (Scenario 2) | When `last_modified` is identical, the **lexicographically higher `device_id` wins**. The losing edit is recorded in `conflict_log` with full context (winner/loser device, values, resolution type). |
| **Delete vs. update** (Scenario 3) | **Delete wins (tombstone policy).** The deleted item stays deleted, and the conflicting updates are surfaced in `conflict_log` with `type: "delete_vs_update"` and the full `discarded_edits` object, so the operator can review and undo. |

### Where operators see conflicts

The `conflict_log` is an **array on the order document itself** — every
auto-resolved conflict gets an entry with:
- `type` — `field_conflict`, `attribute_conflict`, or `delete_vs_update`
- `winner_device` / `loser_device` — which device won/lost
- `winner_value` / `loser_value` — what the values were
- `resolution` — `later_timestamp_wins` or `device_id_tiebreak` or
  `delete_wins_tombstoned`

For Scenario 3, the entry also includes `discarded_edits` — the full edited
item that was discarded by the delete, so nothing is silently lost.

### Determinism guarantee

`reconcileOrder(A, B, base)` and `reconcileOrder(B, A, base)` produce the
exact same merged order. The function is pure — no `Date.now()`,
`Math.random()`, or arrival-order-dependent state. This is verified by
`test-sync.js` which runs all three scenarios in both reconnection orders
and asserts deep equality.

### When sync runs

`syncOrder(orderId)` in `order-service.js` is called by the frontend when
Firestore's `onSnapshot` fires with `hasPendingWrites: false` after a
reconnection. It reads the local (cache) and server versions, reconciles
them if they differ, and writes the merged result back.

### Honest assessment for judges

Scenario 3 (delete-vs-update) is our weakest case in a real-world sense:
delete-wins is the wrong default for some situations (e.g. Device B added
important edits that the operator would want to keep). We chose it because
in an order-management context, a deliberate cancellation should not be
silently undone by a stale edit — and the discarded edits are always
surfaced in `conflict_log`, so the operator can reverse the decision. A
production system would likely surface this as a UI prompt ("Device B edited
an item that Device A deleted — which do you want to keep?") rather than
auto-resolving.
