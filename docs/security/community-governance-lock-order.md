# Community governance membership lock order

Production membership transitions must use `govern_community_member`, which acquires the community row before target membership row(s). This community → membership order serializes governance operations and avoids opposite acquisition order between cooperating RPC callers.

Direct RLS-protected writes remain a compatibility and test-only path; they do not promise the canonical lock order. A direct membership UPDATE may acquire a membership row before a row trigger requests the community lock, reversing the order and creating a deadlock when it contends with the governance RPC. Do not use direct membership writes in production handlers. When direct writes are unavoidable for fixtures, keep them isolated from concurrent governance work.

The handler does not automatically retry deadlocks (`40P01`) or serialization failures (`40001`). The transaction rolls back on either error. Surface the retryable conflict to the caller; after refreshing current membership state, an operator or user may explicitly retry the intended action. Never replay blindly: the original transition may no longer be valid.
