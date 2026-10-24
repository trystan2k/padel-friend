// Shared only by trusted local browser fixtures. Take this transaction lock
// before relation locks: concurrent trigger-toggle blocks otherwise acquire
// strong locks on overlapping tables in different orders.
export const matchFixtureLock = { namespace: 73073, key: 108 } as const;

export function serializeMatchFixtureSql(query: string): string {
  return query.replace(
    /^(\s*do\s+\$\$\s+begin\b)/i,
    `$1\n perform pg_advisory_xact_lock(${matchFixtureLock.namespace}, ${matchFixtureLock.key});`
  );
}
