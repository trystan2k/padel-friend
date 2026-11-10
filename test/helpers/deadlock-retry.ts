export const DEADLOCK_SQLSTATE = '40P01';
export const DEADLOCK_MAX_ATTEMPTS = 3;

export function isDeadlockError(error: unknown): boolean {
  let current: unknown = error;
  // The SQL transport wraps driver errors; the SQLSTATE can sit on a cause.
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    if ((current as { code?: unknown }).code === DEADLOCK_SQLSTATE) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Re-runs a single-transaction operation when PostgreSQL aborts it as a deadlock victim (40P01).
 * The aborted transaction is fully rolled back (including trigger DDL), so a retry is sound.
 */
export async function retryOnDeadlock<T>(
  run: () => Promise<T>,
  maxAttempts = DEADLOCK_MAX_ATTEMPTS
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= maxAttempts || !isDeadlockError(error)) throw error;
    }
  }
}
