// Shared only by trusted local browser fixtures. Take this transaction lock
// before relation locks: concurrent trigger-toggle blocks otherwise acquire
// strong locks on overlapping tables in different orders.
export const matchFixtureLock = { namespace: 73073, key: 108 } as const;

export function serializeMatchFixtureSql(query: string): string {
  return query.replace(
    /^(\s*do\s+\$(?:[a-z_][a-z_0-9]*)?\$\s+(?:declare\b[\s\S]*?\b)?begin\b)/i,
    `$1\n perform pg_advisory_xact_lock(${matchFixtureLock.namespace}, ${matchFixtureLock.key});`
  );
}

const DEADLOCK_ATTEMPTS = 3;

export function isDeadlockError(cause: unknown): boolean {
  return cause instanceof Error && /deadlock detected|40P01/i.test(cause.message);
}

/**
 * Another worker's fixture cleanup removes rating evidence in one transaction, while the global
 * rating replay reads its player set and rating state in separate statements. A replay that
 * straddles that commit reports an incomplete player state; the failed call rolled back completely,
 * and the retry sees the committed state. Production never deletes this evidence.
 */
export function isTransientRatingStateError(cause: unknown): boolean {
  return cause instanceof Error && /Incomplete player state/i.test(cause.message);
}

/**
 * A Postgres deadlock victim is rolled back completely, so re-running an atomic local-SQL call
 * (one CLI invocation = one implicit transaction) is safe. Only SQLSTATE 40P01 and the transient
 * incomplete rating state described above are retried, at most 3 attempts; every other failure
 * surfaces immediately.
 */
export async function withDeadlockRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (cause) {
      if (
        !(isDeadlockError(cause) || isTransientRatingStateError(cause)) ||
        attempt >= DEADLOCK_ATTEMPTS
      )
        throw cause;
    }
  }
}
