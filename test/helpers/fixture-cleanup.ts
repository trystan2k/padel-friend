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

// One cleanup batch is a single statement for PostgreSQL. Large fixtures (thousands of
// registrations) plus table-lock waits outgrow the default 30s transport bound on CI runners.
const FIXTURE_CLEANUP_TIMEOUT_MS = 120_000;

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
  'public.result_repair_attempts',
  'public.result_repair_jobs',
  'public.result_dispute_resolutions',
  'public.result_amendment_events',
  'public.result_amendment_candidates',
  'public.result_amendment_requests',
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
  // Leagues are referenced by match events; their audit rows are immutable. leagueEvidenceStatements()
  // removes both right after the events (and before communities/users) in the same transaction.
  'public.league_events',
  'public.leagues',
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
    const ratingEvidence = this.ratingEvidenceStatements();
    const leagueEvidence = this.leagueEvidenceStatements();
    const deleteEntry = (entry: FixtureCleanupEntry) => {
      const predicate = Object.entries(entry.identity)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([column, value]) =>
          value === null
            ? `${quoteColumn(column)} IS NULL`
            : `${quoteColumn(column)} = ${sqlLiteral(value)}`
        )
        .join(' AND ');
      return `DELETE FROM ${quoteTable(entry.table)} WHERE ${predicate}`;
    };
    // Leagues go after every row that may reference them (events) and before their owners.
    const entries = this.sortedEntries();
    const leagueRank = cleanupOrder.get('public.league_events') ?? Number.MAX_SAFE_INTEGER;
    const split = entries.findIndex(
      (entry) => (cleanupOrder.get(entry.table) ?? Number.MAX_SAFE_INTEGER) >= leagueRank
    );
    const head = split < 0 ? entries : entries.slice(0, split);
    const tail = split < 0 ? [] : entries.slice(split);
    const statements = [
      ...(options.beforeStatements ?? []),
      ...this.leagueProjectionEvidenceStatements(),
      ...ratingEvidence.before,
      ...head.map(deleteEntry),
      ...leagueEvidence,
      ...tail.map(deleteEntry),
      ...ratingEvidence.after,
      ...(options.afterStatements ?? [])
    ];
    if (statements.length === 0) return;

    try {
      await executeTrustedSqlBatch(
        statements.map((sql) => ({ sql })),
        { timeoutMs: FIXTURE_CLEANUP_TIMEOUT_MS }
      );
    } catch (error) {
      if (options.restoreOnFailure?.length)
        throw new Error(
          `Fixture cleanup transaction rolled back for namespace ${this.namespace}; trigger restoration DDL was skipped because rollback restored the pre-transaction trigger state`,
          { cause: error }
        );
      throw error;
    }
  }

  /**
   * Immutable rating evidence restrictively references profiles, proposals and events, so
   * removing a registered fixture identity first needs the evidence of exactly those
   * identities gone. The immutability triggers are disabled only inside the cleanup
   * transaction (rollback restores them) and re-enabled before it commits.
   */
  private ratingEvidenceStatements(): { before: string[]; after: string[] } {
    const scopeSelects = {
      users: [] as string[],
      groups: [] as string[],
      events: [] as string[]
    };
    for (const entry of this.sortedEntries()) {
      const predicate = Object.entries(entry.identity)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([column, value]) =>
          value === null
            ? `${quoteColumn(column)} IS NULL`
            : `${quoteColumn(column)} = ${sqlLiteral(value)}`
        )
        .join(' AND ');
      const select = (column: string) =>
        `SELECT ${column} FROM ${quoteTable(entry.table)} WHERE ${predicate}`;
      if (entry.table === 'auth.users') scopeSelects.users.push(select('id'));
      else if (entry.table === 'public.player_profiles') scopeSelects.users.push(select('user_id'));
      else if (entry.table === 'public.match_event_result_proposals') {
        scopeSelects.groups.push(select('id'));
      } else if (entry.table === 'public.match_events') scopeSelects.events.push(select('id'));
    }
    if (scopeSelects.users.length + scopeSelects.groups.length + scopeSelects.events.length === 0)
      return { before: [], after: [] };

    const users = scopeSelects.users.map((sql) => `user_id IN (${sql})`);
    const eventPredicate = [
      ...users,
      ...scopeSelects.groups.map((sql) => `game_group_id IN (${sql})`),
      ...scopeSelects.events.map((sql) => `match_event_id IN (${sql})`)
    ].join(' OR ');
    const triggers = [
      ['player_rating_event_calculations', 'player_rating_calculations_immutable'],
      ['player_rating_event_sources', 'player_rating_event_sources_immutable'],
      ['player_rating_events', 'player_rating_events_immutable'],
      ['player_rating_initializations', 'player_rating_initializations_immutable'],
      ['player_rating_adjustment_states', 'player_rating_adjustment_states_immutable'],
      ['player_rating_admin_adjustments', 'player_rating_adjustments_immutable'],
      ['player_level_review_requests', 'level_review_requests_guard'],
      ['player_level_review_requests', 'level_review_requests_no_delete']
    ] as const;
    return {
      before: [
        ...triggers.map(
          ([table, trigger]) => `ALTER TABLE public.${table} DISABLE TRIGGER ${trigger}`
        ),
        ...(users.length > 0
          ? [
              // Requests and adjustments reference each other: defer both FKs inside the cleanup transaction.
              'SET CONSTRAINTS public.player_rating_adjustment_request_fk, public.level_review_adjustment_fk DEFERRED',
              `DELETE FROM public.player_rating_adjustment_states WHERE adjustment_id IN (SELECT id FROM public.player_rating_admin_adjustments WHERE ${users.join(' OR ')})`,
              `DELETE FROM public.player_level_review_requests WHERE ${users.map((sql) => sql.replace('user_id', 'owner_id')).join(' OR ')}`,
              `DELETE FROM public.player_rating_admin_adjustments WHERE ${users.join(' OR ')}`
            ]
          : []),
        `DELETE FROM public.player_rating_event_calculations WHERE rating_event_id IN (SELECT id FROM public.player_rating_events WHERE ${eventPredicate})`,
        `DELETE FROM public.player_rating_event_sources WHERE rating_event_id IN (SELECT id FROM public.player_rating_events WHERE ${eventPredicate})`,
        `DELETE FROM public.player_rating_events WHERE ${eventPredicate}`,
        ...(users.length > 0
          ? [`DELETE FROM public.player_rating_initializations WHERE ${users.join(' OR ')}`]
          : []),
        // Re-validate the deferred request <-> adjustment FKs before the triggers are re-enabled.
        ...(users.length > 0
          ? [
              'SET CONSTRAINTS public.player_rating_adjustment_request_fk, public.level_review_adjustment_fk IMMEDIATE'
            ]
          : [])
      ],
      after: triggers.map(
        ([table, trigger]) => `ALTER TABLE public.${table} ENABLE TRIGGER ${trigger}`
      )
    };
  }

  /**
   * League projection receipts are immutable and restrictively reference official confirmations
   * and Leagues, so they go before the confirmations. The trigger is disabled only inside the
   * cleanup transaction (rollback restores it) and re-enabled before it commits. Earned counter
   * rows cascade with their League and user.
   */
  private leagueProjectionEvidenceStatements(): string[] {
    const scopes: string[] = [];
    // Snapshots have no match_event_id; their late revisions point at a confirmation instead.
    const snapshotScopes: string[] = [];
    for (const entry of this.sortedEntries()) {
      const predicate = Object.entries(entry.identity)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([column, value]) =>
          value === null
            ? `${quoteColumn(column)} IS NULL`
            : `${quoteColumn(column)} = ${sqlLiteral(value)}`
        )
        .join(' AND ');
      const select = (column: string) =>
        `SELECT ${column} FROM ${quoteTable(entry.table)} WHERE ${predicate}`;
      if (entry.table === 'public.communities') {
        scopes.push(`community_id IN (${select('id')})`);
        snapshotScopes.push(`community_id IN (${select('id')})`);
      } else if (entry.table === 'auth.users') {
        const owned = `league_id IN (SELECT id FROM public.leagues WHERE owner_id IN (${select('id')}))`;
        scopes.push(owned);
        snapshotScopes.push(owned);
      } else if (entry.table === 'public.leagues') {
        scopes.push(`league_id IN (${select('id')})`);
        snapshotScopes.push(`league_id IN (${select('id')})`);
      } else if (entry.table === 'public.match_events') {
        scopes.push(`match_event_id IN (${select('id')})`);
        snapshotScopes.push(
          `triggering_confirmation_id IN (SELECT id FROM public.match_event_result_confirmations WHERE match_event_id IN (${select('id')}))`
        );
      }
    }
    if (scopes.length === 0) return [];
    return [
      'ALTER TABLE public.league_standings_snapshots DISABLE TRIGGER league_standings_snapshots_immutable',
      `DELETE FROM public.league_standings_snapshots WHERE ${snapshotScopes.join(' OR ')}`,
      'ALTER TABLE public.league_standings_snapshots ENABLE TRIGGER league_standings_snapshots_immutable',
      'ALTER TABLE public.league_projection_confirmations DISABLE TRIGGER league_projection_confirmations_immutable',
      `DELETE FROM public.league_projection_confirmations WHERE ${scopes.join(' OR ')}`,
      'ALTER TABLE public.league_projection_confirmations ENABLE TRIGGER league_projection_confirmations_immutable'
    ];
  }

  /**
   * League audit rows are immutable and Leagues restrictively reference communities and owner
   * users, so registered communities, users and Leagues need their League evidence gone first.
   * The immutability trigger is disabled only inside the cleanup transaction (rollback restores
   * it) and re-enabled before it commits.
   */
  private leagueEvidenceStatements(): string[] {
    const scopes: string[] = [];
    for (const entry of this.sortedEntries()) {
      const predicate = Object.entries(entry.identity)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([column, value]) =>
          value === null
            ? `${quoteColumn(column)} IS NULL`
            : `${quoteColumn(column)} = ${sqlLiteral(value)}`
        )
        .join(' AND ');
      const select = (column: string) =>
        `SELECT ${column} FROM ${quoteTable(entry.table)} WHERE ${predicate}`;
      if (entry.table === 'public.communities') scopes.push(`community_id IN (${select('id')})`);
      else if (entry.table === 'auth.users') scopes.push(`owner_id IN (${select('id')})`);
      else if (entry.table === 'public.leagues') scopes.push(`id IN (${select('id')})`);
    }
    if (scopes.length === 0) return [];
    const leagues = `SELECT id FROM public.leagues WHERE ${scopes.join(' OR ')}`;
    return [
      'ALTER TABLE public.league_events DISABLE TRIGGER league_events_immutable',
      'ALTER TABLE public.league_event_references DISABLE TRIGGER league_event_references_immutable',
      `DELETE FROM public.league_events WHERE league_id IN (${leagues})`,
      `DELETE FROM public.league_event_references WHERE league_id IN (${leagues})`,
      `DELETE FROM public.leagues WHERE id IN (${leagues})`,
      'ALTER TABLE public.league_event_references ENABLE TRIGGER league_event_references_immutable',
      'ALTER TABLE public.league_events ENABLE TRIGGER league_events_immutable'
    ];
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

/**
 * Multi-statement SQL removing the immutable rating evidence of fixture users, to run in
 * the same transaction right before their profiles/auth rows are deleted by raw SQL.
 * `userIdsSql` is a trusted SQL fragment producing user ids (e.g. a literal id list).
 */
export function ratingEvidenceCleanupSql(userIdsSql: string): string {
  return `ALTER TABLE public.player_rating_adjustment_states DISABLE TRIGGER player_rating_adjustment_states_immutable;
    ALTER TABLE public.player_rating_admin_adjustments DISABLE TRIGGER player_rating_adjustments_immutable;
    ALTER TABLE public.player_level_review_requests DISABLE TRIGGER level_review_requests_guard;
    ALTER TABLE public.player_level_review_requests DISABLE TRIGGER level_review_requests_no_delete;
    SET CONSTRAINTS public.player_rating_adjustment_request_fk, public.level_review_adjustment_fk DEFERRED;
    DELETE FROM public.player_rating_adjustment_states WHERE adjustment_id IN (SELECT id FROM public.player_rating_admin_adjustments WHERE user_id IN (${userIdsSql}));
    DELETE FROM public.player_level_review_requests WHERE owner_id IN (${userIdsSql});
    DELETE FROM public.player_rating_admin_adjustments WHERE user_id IN (${userIdsSql});
    ALTER TABLE public.player_rating_event_calculations DISABLE TRIGGER player_rating_calculations_immutable;
    ALTER TABLE public.player_rating_event_sources DISABLE TRIGGER player_rating_event_sources_immutable;
    ALTER TABLE public.player_rating_events DISABLE TRIGGER player_rating_events_immutable;
    ALTER TABLE public.player_rating_initializations DISABLE TRIGGER player_rating_initializations_immutable;
    DELETE FROM public.player_rating_event_calculations WHERE rating_event_id IN (SELECT id FROM public.player_rating_events WHERE user_id IN (${userIdsSql}));
    DELETE FROM public.player_rating_event_sources WHERE rating_event_id IN (SELECT id FROM public.player_rating_events WHERE user_id IN (${userIdsSql}));
    DELETE FROM public.player_rating_events WHERE user_id IN (${userIdsSql});
    DELETE FROM public.player_rating_initializations WHERE user_id IN (${userIdsSql});
    ALTER TABLE public.player_rating_initializations ENABLE TRIGGER player_rating_initializations_immutable;
    ALTER TABLE public.player_rating_events ENABLE TRIGGER player_rating_events_immutable;
    ALTER TABLE public.player_rating_event_sources ENABLE TRIGGER player_rating_event_sources_immutable;
    ALTER TABLE public.player_rating_event_calculations ENABLE TRIGGER player_rating_calculations_immutable;
    SET CONSTRAINTS public.player_rating_adjustment_request_fk, public.level_review_adjustment_fk IMMEDIATE;
    ALTER TABLE public.player_level_review_requests ENABLE TRIGGER level_review_requests_no_delete;
    ALTER TABLE public.player_level_review_requests ENABLE TRIGGER level_review_requests_guard;
    ALTER TABLE public.player_rating_admin_adjustments ENABLE TRIGGER player_rating_adjustments_immutable;
    ALTER TABLE public.player_rating_adjustment_states ENABLE TRIGGER player_rating_adjustment_states_immutable;`;
}

export function createFixtureCleanupRegistry(scope: string): FixtureCleanupRegistry {
  return new FixtureCleanupRegistry(scope);
}
