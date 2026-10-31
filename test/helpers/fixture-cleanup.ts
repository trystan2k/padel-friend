import {
  executeTrustedSqlBatch,
  queryTrustedSql,
  registerSqlTransportCleanup
} from './sql-transport';

export type FixtureIdentityValue = string | number | boolean | null;
export type FixtureIdentity = Readonly<Record<string, FixtureIdentityValue>>;
export type FixtureCleanupExecutor = (registry: FixtureCleanupRegistry) => Promise<void>;
export type FixtureCleanupOptions = {
  beforeStatements?: readonly string[];
  afterStatements?: readonly string[];
  restoreOnFailure?: readonly string[];
};

type FixtureCleanupEntry = {
  table: string;
  identity: FixtureIdentity;
  key: string;
};

const IDENTIFIER = /^[a-z_][a-z\d_]{0,62}$/i;

/** Child tables precede parents. Domain fixtures with cyclic FKs supply an executor. */
export const FIXTURE_CLEANUP_TABLE_ORDER = [
  'public.community_notifications',
  'public.community_request_messages',
  'public.notification_result_links',
  'public.match_event_result_entry_ready_dispatch',
  'public.match_result_alert_entry_ready_queue',
  'public.match_result_alert_deadline_queue',
  'public.match_result_alert_processing_state',
  'public.match_result_alert_retry_fallback',
  'public.notifications',
  'public.match_event_audit_log',
  'public.match_event_result_processing_state',
  'public.match_event_result_reviews',
  'public.match_event_result_confirmations',
  'public.match_event_result_proposal_versions',
  'public.match_event_result_proposals',
  'public.match_event_invites',
  'public.match_event_management_commands',
  'public.match_event_registration_attempts',
  'public.match_event_registrations',
  'public.match_event_registration_state',
  // Provisional provenance references its source event and inviter.
  'public.player_profiles',
  'public.community_members',
  'public.match_events',
  'storage.objects',
  'public.community_venues',
  'public.community_invitations',
  'public.community_audit_log',
  'public.communities',
  'public.community_invitee_directory_preferences',
  'public.notification_preferences',
  'auth.users'
] as const;

const cleanupOrder = new Map<string, number>(
  FIXTURE_CLEANUP_TABLE_ORDER.map((table, index) => [table, index])
);

function quoteTable(table: string): string {
  const parts = table.split('.');
  if (parts.length !== 2 || parts.some((part) => !IDENTIFIER.test(part)))
    throw new Error(`Invalid fixture cleanup table: ${table}`);
  return parts.map((part) => `"${part}"`).join('.');
}

function quoteColumn(column: string): string {
  if (!IDENTIFIER.test(column)) throw new Error(`Invalid fixture cleanup column: ${column}`);
  return `"${column}"`;
}

function normalizeNamespace(scope: string): string {
  const normalized = scope
    .toLowerCase()
    .replace(/[^a-z\d]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!normalized) throw new Error('Fixture cleanup scope must contain a letter or number');
  return normalized;
}

function identityKey(identity: FixtureIdentity): string {
  const fields = Object.entries(identity).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(fields);
}

function identityPredicate(identity: FixtureIdentity): {
  sql: string;
  values: FixtureIdentityValue[];
} {
  const entries = Object.entries(identity).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) throw new Error('Fixture cleanup identity cannot be empty');
  const values: FixtureIdentityValue[] = [];
  const conditions = entries.map(([column, value]) => {
    const quotedColumn = quoteColumn(column);
    if (value === null) return `${quotedColumn} IS NULL`;
    values.push(value);
    return `${quotedColumn} = $${values.length}`;
  });
  return { sql: conditions.join(' AND '), values };
}

function sqlLiteral(value: FixtureIdentityValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Fixture cleanup number must be finite');
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Tracks only fixture rows explicitly registered by their existing identity columns.
 * Each instance has one namespace token, stable for the run and unique across runs.
 */
export class FixtureCleanupRegistry {
  readonly namespace: string;
  private readonly entries = new Map<string, FixtureCleanupEntry>();
  private cleanupExecutor: FixtureCleanupExecutor | undefined;
  private cleanupCompleted = false;

  constructor(scope: string) {
    this.namespace = `${normalizeNamespace(scope)}-${process.pid}-${crypto.randomUUID().replaceAll('-', '')}`;
    registerSqlTransportCleanup(() => this.cleanup());
  }

  /** Register before creating a row where possible, so partial setup still cleans. */
  register(table: string, identity: FixtureIdentity): void {
    if (this.cleanupCompleted) throw new Error('Cannot register fixture rows after cleanup');
    quoteTable(table);
    identityPredicate(identity);
    const copiedIdentity = Object.fromEntries(
      Object.entries(identity).sort(([left], [right]) => left.localeCompare(right))
    ) as FixtureIdentity;
    const key = `${table}:${identityKey(copiedIdentity)}`;
    if (!this.entries.has(key)) this.entries.set(key, { table, identity: copiedIdentity, key });
  }

  /** Install ordered domain cleanup when DDL guards or cyclic FKs need special handling. */
  setCleanupExecutor(executor: FixtureCleanupExecutor): void {
    if (this.cleanupCompleted) throw new Error('Cannot change cleanup after it completed');
    this.cleanupExecutor = executor;
  }

  async cleanup(): Promise<void> {
    if (this.cleanupCompleted) {
      return;
    }

    const failures: unknown[] = [];
    try {
      if (this.cleanupExecutor) await this.cleanupExecutor(this);
      else await this.deleteRegisteredRowsInOrder();
    } catch (error) {
      failures.push(error);
    }

    try {
      await this.assertNoResidue();
    } catch (error) {
      failures.push(error);
    }

    if (failures.length > 0)
      throw new AggregateError(failures, `Fixture cleanup failed for namespace ${this.namespace}`);
    this.cleanupCompleted = true;
  }

  async assertNoResidue(): Promise<void> {
    const residue: string[] = [];
    for (const entry of this.sortedEntries()) {
      const predicate = identityPredicate(entry.identity);
      const result = await queryTrustedSql(
        `SELECT count(*)::int AS count FROM ${quoteTable(entry.table)} WHERE ${predicate.sql}`,
        { values: predicate.values }
      );
      const count = Number(result.rows[0]?.['count'] ?? 0);
      if (!Number.isSafeInteger(count) || count < 0)
        throw new Error(`Invalid residue count for ${entry.table} in ${this.namespace}`);
      if (count > 0) residue.push(`${entry.table}: ${count} row(s)`);
    }
    if (residue.length > 0)
      throw new Error(`Fixture residue remains in ${this.namespace}: ${residue.join(', ')}`);
  }

  async deleteRegisteredRowsInOrder(options: FixtureCleanupOptions = {}): Promise<void> {
    const statements = [
      ...(options.beforeStatements ?? []),
      ...this.sortedEntries().map((entry) => {
        const predicate = Object.entries(entry.identity)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([column, value]) =>
            value === null
              ? `${quoteColumn(column)} IS NULL`
              : `${quoteColumn(column)} = ${sqlLiteral(value)}`
          )
          .join(' AND ');
        return `DELETE FROM ${quoteTable(entry.table)} WHERE ${predicate}`;
      }),
      ...(options.afterStatements ?? [])
    ];
    if (statements.length === 0) return;

    try {
      await executeTrustedSqlBatch(statements.map((sql) => ({ sql })));
    } catch (error) {
      if (options.restoreOnFailure?.length)
        throw new Error(
          `Fixture cleanup transaction rolled back for namespace ${this.namespace}; trigger restoration DDL was skipped because rollback restored the pre-transaction trigger state`,
          { cause: error }
        );
      throw error;
    }
  }

  private sortedEntries(): FixtureCleanupEntry[] {
    return [...this.entries.values()].sort((left, right) => {
      const orderDelta =
        (cleanupOrder.get(left.table) ?? Number.MAX_SAFE_INTEGER) -
        (cleanupOrder.get(right.table) ?? Number.MAX_SAFE_INTEGER);
      return (
        orderDelta || left.table.localeCompare(right.table) || left.key.localeCompare(right.key)
      );
    });
  }
}

export function createFixtureCleanupRegistry(scope: string): FixtureCleanupRegistry {
  return new FixtureCleanupRegistry(scope);
}
