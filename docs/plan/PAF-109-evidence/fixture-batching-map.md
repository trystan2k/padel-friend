# PAF-113 fixture-batching map

Batch only within committed fixture setup or read-snapshot boundaries. No batch spans an assertion, authenticated HTTP call, held lock, or commit whose visibility is part of the contract. Existing behavior assertions and real auth/RLS paths remain in place.

| Suite | Change or decision | Boundary proof | Regression proof retained |
| --- | --- | --- | --- |
| `test/matches.registration.cutoff.integration.test.ts` | Replaced 15 per-event state reads plus 15 marker reads with one `registrationSnapshotsByEventIds` query. Fixture DML remains its existing single trusted `DO` request. | Snapshot runs after fixture SQL commits and before any behavioral RPC, lock barrier, or assertion-driven mutation. Cron is unscheduled by the fixture before state is seeded. | Same per-event `{ next, revision: 0 }` and null-marker expectations still run for all 15 event identities. Signup, authenticated RPC, cutoff-boundary, rollback, and lock-barrier checks unchanged. |
| `test/matches.registration.fifo.integration.test.ts` | Replaced 9 initial per-event state reads with one snapshot query. Existing seed `DO` already batches its fixture DML. | One committed read snapshot after seed completion; no RPC or assertion sits between event reads. Events have future cutoffs. | Same per-event initial state expectations remain. Real signups, RLS reads, FIFO transitions, and concurrency barriers unchanged. |
| `test/matches.registration.actions.integration.test.ts` | Replaced 11 initial per-event state reads with one snapshot query. Existing seed `DO` already batches its fixture DML. | Snapshot runs after seed commit and before action/RPC behavior. No lock or HTTP call occurs between reads. | Same per-event initial state expectations remain. Real signup/onboarding, authenticated RLS calls, action outcomes, and raw lock contenders unchanged. |
| `test/community.integration.test.ts` | Batches five independent membership fixture inserts in one `executeTrustedSqlBatch` request. Each insert keeps its `expectedRowCount: 1` check immediately after execution; fixture IDs are generated before SQL. | All five setup rows precede the first promotion HTTP call. No read, assertion, or request occurs between inserts. Batch executes statements in order on one pooled connection; commit completes before the authenticated promotion. | Active/pending/inactive actor identities, membership states, dates, IDs used by later assertions, `member_count` expectations, and promotion/reactivation calls remain. No RLS/auth assertions removed. |
| `test/matches.invitations.integration.test.ts` / `test/helpers/match-management-fixtures.ts` | No batching change. Each event's fixture DML is already one `DO` request; invite-ID lookup intentionally remains a separate read after commit. Per-member signup is followed by its membership insert, so those statements cannot be batched without crossing a real auth call. | Preserves commit visibility before invite-ID read and keeps each auth/signup boundary intact. The private-outsider scenario retains its distinct non-member identity. | Real signup, invitation RPC authorization, RLS, cutoff and lock-barrier assertions unchanged. |

The transport batch API reports the original PostgreSQL SQLSTATE/message/detail and adds a zero-based failing statement index to `detail`. Optional row-count expectations execute immediately after each statement. Batch failures evict the pooled connection; successful batches run the existing rollback/advisory-lock/session reset hygiene. One integration test verifies order, row-count support, SQLSTATE/detail preservation, and failure index.

No assertions were removed, weakened, or moved across a behavioral boundary. All batched database reads are one `SELECT` snapshot after fixture commit; all auth/RLS and lock-observation calls remain unprivileged HTTP/dedicated-connection paths.

## Timing evidence

Same local Supabase environment, default Vitest reporter, identical five-suite command and file list (cutoff, FIFO, actions, invitations, community):

| Sample | Files | Tests | Vitest duration | Shell wall time |
| --- | ---: | ---: | ---: | ---: |
| Before PAF-113 edits | 5 | 83 | 32.13s | 34.64s |
| After sample A | 5 | 83 | 31.63s | 34.02s |
| After sample B | 5 | 83 | 33.07s | 35.52s |

These post-change samples show **no reliable runtime improvement**: sample A is faster than baseline, sample B is slower. Per-call CLI round-trip overhead had already been eliminated by PAF-112's persistent transport, so PAF-113 batching is not credited with an observed wall-time improvement.

Full integration comparison (same local environment):

| Sample | Reporter | Tests | Vitest duration | Delta vs baseline |
| --- | --- | ---: | ---: | ---: |
| Before PAF-113 edits | default | 290 | 107.12s | — |
| After full run A | default | 291 | 123.16s | +16.04s |
| After timing-detail run B | default + JSON output | 291 | 113.54s | +6.42s |

The timing-detail run kept the default reporter and added a JSON reporter to retain per-file timing. File durations from that full run, compared with the supplied baseline anchors:

| Integration suite | Baseline | After run B | Delta |
| --- | ---: | ---: | ---: |
| Invitations | 10.41s | 10.97s | +0.56s |
| Management edits | 7.10s | 7.27s | +0.17s |
| Registration cutoff | 2.96s | 2.66s | -0.30s |
| Results submission | 3.47s | 3.64s | +0.17s |

Full-run samples also establish no reliable wall-time improvement; both post-change totals exceed the 107.12s baseline, and post-change totals vary by 9.62s. No causal runtime claim is made from these samples. Remaining value is structural: fewer fixture round-trips, consistent snapshot reads, and indexed batch errors. These benefits are not presented as measured runtime savings.