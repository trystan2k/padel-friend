import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll } from 'vitest';
import {
  Client,
  Pool,
  types as pgTypes,
  type PoolClient,
  type QueryResult,
  type QueryResultRow
} from 'pg';

export type SqlRow = Record<string, unknown>;
export type SqlError = { code: string | null; message: string; detail: string | null };
export type SqlResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  sqlError?: SqlError;
};
export type SqlHandle = {
  backendPid: Promise<number>;
  done: Promise<SqlResult>;
  stop: (gracePeriodMs?: number) => Promise<void>;
};
export type CliSqlHandle = {
  done: Promise<SqlResult>;
  stop: (gracePeriodMs?: number) => Promise<void>;
};
export type SqlQueryOptions = {
  timeoutMs?: number;
  values?: unknown[];
};

export const SQL_TRANSPORT_BOUNDS = {
  maxConnections: 10,
  acquireTimeoutMs: 5_000,
  queryTimeoutMs: 30_000
} as const;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const CONNECTION_TIMEOUT_MS = SQL_TRANSPORT_BOUNDS.acquireTimeoutMs;
const QUERY_TIMEOUT_MS = SQL_TRANSPORT_BOUNDS.queryTimeoutMs;
const APPLICATION_NAME = `paf-test-sql-${process.pid}-${randomUUID().slice(0, 8)}`;
const CLI_TEMPORAL_TYPE_OIDS = new Set([1082, 1114, 1184]);

// pg's default parser converts PostgreSQL timestamps to JavaScript Date, losing
// PostgreSQL's sub-millisecond precision. Retain wire text so queryResult can
// reproduce the former CLI JSON timestamp contract exactly.
const CLI_COMPATIBLE_TYPES = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (format !== 'binary' && CLI_TEMPORAL_TYPE_OIDS.has(oid)) return (value: string) => value;
    return pgTypes.getTypeParser(oid, format);
  }
} satisfies { getTypeParser: typeof pgTypes.getTypeParser };

let databaseUrlPromise: Promise<string> | undefined;
let poolPromise: Promise<Pool> | undefined;
let transportConnectionWasOpened = false;
const dedicatedConnections = new Set<DedicatedSqlConnection>();

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

/** Rejects every PostgreSQL target outside local Supabase loopback hosts. */
export function assertLoopbackDatabaseUrl(connectionString: string): string {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('Supabase DB_URL is invalid');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
    throw new Error('Refusing non-PostgreSQL Supabase DB_URL');

  const host = normalizeHostname(parsed.hostname);
  if (!LOOPBACK_HOSTS.has(host))
    throw new Error(`Refusing non-loopback PostgreSQL database host: ${host || '(missing)'}`);
  return connectionString;
}

function localDatabaseUrl(): Promise<string> {
  databaseUrlPromise ??= Promise.resolve().then(() => {
    let status: string;
    try {
      status = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: CONNECTION_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch {
      throw new Error('Could not resolve local Supabase DB_URL with `supabase status -o env`');
    }

    const rawUrl = status.match(/^DB_URL=(.*)$/m)?.[1]?.trim();
    const connectionString = rawUrl?.replace(/^(?:"(.*)"|'(.*)')$/, '$1$2');
    if (!connectionString) throw new Error('Supabase status did not report DB_URL');
    return assertLoopbackDatabaseUrl(connectionString);
  });
  return databaseUrlPromise;
}

function getPool(): Promise<Pool> {
  poolPromise ??= localDatabaseUrl().then((connectionString) => {
    const created = new Pool({
      connectionString,
      application_name: APPLICATION_NAME,
      options: '-c timezone=UTC',
      types: CLI_COMPATIBLE_TYPES,
      max: SQL_TRANSPORT_BOUNDS.maxConnections,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: 1_000,
      allowExitOnIdle: true
    });
    created.on('error', (error: Error) => {
      // node-postgres removes failed idle clients; contain and report the discarded socket.
      console.warn('[trusted SQL transport] discarded idle PostgreSQL connection', error);
    });
    return created;
  });
  return poolPromise;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

class SqlTransportError extends Error implements SqlError {
  readonly code: string | null;
  readonly detail: string | null;

  constructor(error: SqlError, cause: unknown) {
    super(error.message, { cause });
    this.name = 'SqlTransportError';
    this.code = error.code;
    this.detail = error.detail;
  }
}

function normalizeSqlError(value: unknown): SqlTransportError {
  if (value instanceof SqlTransportError) return value;

  const error =
    value && typeof value === 'object'
      ? (value as {
          code?: unknown;
          message?: unknown;
          detail?: unknown;
        })
      : undefined;
  let message: string;
  if (typeof error?.message === 'string') {
    message = error.message;
  } else if (typeof value === 'string' || value === null || value === undefined) {
    message = String(value);
  } else {
    try {
      message = JSON.stringify(value) ?? Object.prototype.toString.call(value);
    } catch {
      message = Object.prototype.toString.call(value);
    }
  }

  return new SqlTransportError(
    {
      code: typeof error?.code === 'string' ? error.code : null,
      message,
      detail: typeof error?.detail === 'string' ? error.detail : null
    },
    value
  );
}

/** Direct SQL failures expose SQLSTATE as `code`, plus PostgreSQL message and detail. */
export function sqlErrorMessage(value: unknown): string {
  const error = normalizeSqlError(value);
  const code = error.code ? `${error.code}: ` : '';
  const detail = error.detail ? `\nDETAIL: ${error.detail}` : '';
  return `${code}${error.message}${detail}`;
}

function formatCliTimestamp(value: string, withTimeZone: boolean): string {
  const parts =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(value);
  if (!parts) return value;

  const [, date, time, rawFraction, rawOffset] = parts;
  const fraction = rawFraction?.slice(1).replace(/0+$/, '');
  const fractionSuffix = fraction ? `.${fraction}` : '';
  if (!withTimeZone) return `${date}T${time}${fractionSuffix}Z`;

  if (!rawOffset) return `${date}T${time}${fractionSuffix}Z`;
  const offset =
    rawOffset === 'Z'
      ? rawOffset
      : rawOffset.includes(':')
        ? rawOffset
        : rawOffset.length === 5
          ? `${rawOffset.slice(0, 3)}:${rawOffset.slice(3)}`
          : `${rawOffset}:00`;
  const instant = new Date(`${date}T${time}${offset}`);
  if (Number.isNaN(instant.getTime())) return value;
  return `${instant.toISOString().slice(0, 19)}${fractionSuffix}Z`;
}

function formatCliTemporalValue(oid: number, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (oid === 1082 && /^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;
  if (oid === 1114) return formatCliTimestamp(value, false);
  if (oid === 1184) return formatCliTimestamp(value, true);
  return value;
}

function queryResult(
  result: QueryResult<QueryResultRow> | QueryResult<QueryResultRow>[]
): QueryResult<SqlRow> {
  const normalized = Array.isArray(result) ? result.at(-1) : result;
  if (!normalized) throw new Error('PostgreSQL returned no query result');
  const rows = normalized.rows.map((row) => {
    const normalizedRow: SqlRow = { ...row };
    for (const field of normalized.fields) {
      const value = normalizedRow[field.name];
      if (CLI_TEMPORAL_TYPE_OIDS.has(field.dataTypeID)) {
        normalizedRow[field.name] = formatCliTemporalValue(field.dataTypeID, value);
      } else if (field.dataTypeID === 20 && typeof value === 'string') {
        // The former CLI JSON path parsed int8 values as JavaScript numbers.
        normalizedRow[field.name] = Number(value);
      }
    }
    return normalizedRow;
  });
  return { ...normalized, rows };
}

async function resetPooledSession(client: PoolClient): Promise<void> {
  // CLI-per-call semantics discarded transactions, advisory locks, GUCs, roles,
  // prepared statements, listeners, and temporary objects with every process.
  await client.query('ROLLBACK');
  await client.query('SELECT pg_catalog.pg_advisory_unlock_all()');
  await client.query('DISCARD ALL');
  // DISCARD ALL resets user-set parameters. Keep leak accounting scoped to this
  // helper after restoring its transport-specific application name.
  await client.query(`SET application_name = '${APPLICATION_NAME}'`);
}

/** Executes trusted test SQL on a bounded reusable connection. */
export async function queryTrustedSql(
  sql: string,
  options: SqlQueryOptions = {}
): Promise<QueryResult<SqlRow>> {
  if (!sql.trim()) throw new Error('Trusted SQL cannot be empty');
  const timeoutMs = options.timeoutMs ?? QUERY_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error('Trusted SQL timeout must be a positive integer');

  const currentPool = await getPool();
  const client = await currentPool.connect();
  transportConnectionWasOpened = true;
  try {
    await client.query(`SET statement_timeout = '${timeoutMs}ms'`);
    const result = queryResult(await client.query(sql, options.values));
    await resetPooledSession(client);
    client.release();
    return result;
  } catch (error) {
    // SQL errors, query cancellation, and broken sockets all evict this client.
    // A later acquire must establish a fresh, healthy backend.
    client.release(asError(error));
    throw normalizeSqlError(error);
  }
}

/** Executes trusted fixture SQL whose result rows are not needed. */
export async function executeTrustedSql(sql: string, options: SqlQueryOptions = {}): Promise<void> {
  await queryTrustedSql(sql, options);
}

export type DedicatedSqlConnection = {
  readonly backendPid: number;
  readonly isBusy: boolean;
  query: (sql: string, options?: SqlQueryOptions) => Promise<QueryResult<SqlRow>>;
  cancel: () => Promise<boolean>;
  terminate: () => Promise<boolean>;
  close: () => Promise<void>;
};

/** Opens an independently owned backend for lock holders, probes, or contenders. */
export async function openDedicatedSqlConnection(): Promise<DedicatedSqlConnection> {
  const client = new Client({
    connectionString: await localDatabaseUrl(),
    application_name: APPLICATION_NAME,
    options: '-c timezone=UTC',
    types: CLI_COMPATIBLE_TYPES,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS
  });
  let closed = false;
  let inFlight = false;
  let activeQuery: Promise<QueryResult<SqlRow>> | undefined;
  let backendPid: number;
  let recentQueryFailureWasHandled = false;

  client.on('error', (error: Error) => {
    // In-flight query failures are delivered through that query's promise. The listener
    // contains pg.Client's separate EventEmitter error so intentional backend termination
    // cannot escape as an unhandled error event. Keep unexpected idle disconnects visible.
    if (inFlight || recentQueryFailureWasHandled) return;
    console.warn('[trusted SQL transport] dedicated PostgreSQL connection failed', error);
  });

  try {
    await client.connect();
    transportConnectionWasOpened = true;
    const result = await client.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid');
    backendPid = Number(result.rows[0]?.pid);
    if (!Number.isInteger(backendPid))
      throw new Error('Could not identify dedicated PostgreSQL backend');
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }

  let connection: DedicatedSqlConnection;
  const query = (sql: string, options: SqlQueryOptions = {}): Promise<QueryResult<SqlRow>> => {
    if (closed) return Promise.reject(new Error('Dedicated PostgreSQL connection is closed'));
    if (inFlight)
      return Promise.reject(
        new Error('Dedicated PostgreSQL connection already has a query in flight')
      );
    if (!sql.trim()) return Promise.reject(new Error('Trusted SQL cannot be empty'));
    const timeoutMs = options.timeoutMs ?? QUERY_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
      return Promise.reject(new Error('Trusted SQL timeout must be a positive integer'));

    inFlight = true;
    recentQueryFailureWasHandled = false;
    const operation = (async () => {
      try {
        if (timeoutMs !== QUERY_TIMEOUT_MS)
          await client.query(`SET statement_timeout = '${timeoutMs}ms'`);
        return queryResult(await client.query(sql, options.values));
      } catch (error) {
        recentQueryFailureWasHandled = true;
        throw normalizeSqlError(error);
      }
    })().finally(() => {
      inFlight = false;
      activeQuery = undefined;
    });
    activeQuery = operation;
    return operation;
  };

  const controlQuery = async (
    fn: 'pg_cancel_backend' | 'pg_terminate_backend'
  ): Promise<boolean> => {
    if (!inFlight) return false;
    const result = await queryTrustedSql(`SELECT pg_catalog.${fn}($1::integer) AS changed`, {
      values: [backendPid]
    });
    return result.rows[0]?.['changed'] === true;
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    if (activeQuery) {
      const pending = activeQuery;
      await controlQuery('pg_cancel_backend').catch(() => false);
      await Promise.race([
        pending.then(
          () => undefined,
          () => undefined
        ),
        delay(1_000)
      ]);
      if (inFlight) {
        await controlQuery('pg_terminate_backend').catch(() => false);
        await Promise.race([
          pending.then(
            () => undefined,
            () => undefined
          ),
          delay(1_000)
        ]);
      }
    }
    closed = true;
    dedicatedConnections.delete(connection);
    await client.end().catch(() => undefined);
  };

  connection = {
    get backendPid() {
      return backendPid;
    },
    get isBusy() {
      return inFlight;
    },
    query,
    cancel: () => controlQuery('pg_cancel_backend'),
    terminate: () => controlQuery('pg_terminate_backend'),
    close
  };
  dedicatedConnections.add(connection);
  return connection;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Starts a one-query dedicated session with explicit backend identity and cancellation. */
export function startSql(sql: string): SqlHandle {
  const connectionPromise = openDedicatedSqlConnection();
  const operation = connectionPromise.then(async (connection): Promise<SqlResult> => {
    try {
      const result = await connection.query(sql);
      return { code: 0, stdout: JSON.stringify(result.rows), stderr: '' };
    } catch (error) {
      const sqlError = normalizeSqlError(error);
      return { code: 1, stdout: '', stderr: sqlErrorMessage(sqlError), sqlError };
    }
  });
  const done = operation.catch((error): SqlResult => {
    const sqlError = normalizeSqlError(error);
    return { code: null, stdout: '', stderr: sqlErrorMessage(sqlError), sqlError };
  });
  const stop = async (gracePeriodMs = 1_000): Promise<void> => {
    const connection = await connectionPromise.catch(() => undefined);
    if (!connection) return;
    if (connection.isBusy) {
      await connection.cancel().catch(() => false);
      await Promise.race([done.then(() => undefined), delay(gracePeriodMs)]);
    }
    await connection.close();
  };
  return { backendPid: connectionPromise.then((connection) => connection.backendPid), done, stop };
}

/** Retained per-call Supabase CLI path for CLI/migration contract tests only. */
export function startCliSql(sql: string): CliSqlHandle {
  const child = spawn(
    'pnpm',
    ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', sql],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => (stdout += chunk));
  child.stderr.on('data', (chunk: string) => (stderr += chunk));
  const done = new Promise<SqlResult>((resolve) => {
    child.once('error', (error: Error) =>
      resolve({ code: null, stdout, stderr: `${stderr}${error}` })
    );
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const signalTree = (signal: NodeJS.Signals) => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  const isGroupAlive = (): boolean => {
    if (child.pid === undefined) return false;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      return (
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM'
      );
    }
  };
  const stop = async (gracePeriodMs = 1_000): Promise<void> => {
    if (!exited()) {
      signalTree('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, gracePeriodMs);
        child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (isGroupAlive()) {
      signalTree('SIGKILL');
      for (let waitedMs = 0; waitedMs < gracePeriodMs && isGroupAlive(); waitedMs += 25)
        await delay(25);
    }
  };
  return { done, stop };
}

/** Reports live backends owned by this transport instance for leak assertions. */
export async function countSqlTransportBackends(): Promise<number> {
  const client = new Client({
    connectionString: await localDatabaseUrl(),
    application_name: `paf-test-sql-audit-${process.pid}-${randomUUID().slice(0, 8)}`,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS
  });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM pg_catalog.pg_stat_activity WHERE application_name = $1',
      [APPLICATION_NAME]
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

export async function closeSqlTransport(): Promise<void> {
  await Promise.all([...dedicatedConnections].map((connection) => connection.close()));
  if (poolPromise) {
    const currentPool = await poolPromise.catch(() => undefined);
    poolPromise = undefined;
    if (currentPool) await currentPool.end();
  }
}

afterAll(async () => {
  if (!transportConnectionWasOpened) return;
  await closeSqlTransport();
  const leakedBackends = await countSqlTransportBackends();
  if (leakedBackends !== 0)
    throw new Error(`Trusted SQL transport leaked ${leakedBackends} PostgreSQL backend(s)`);
});
