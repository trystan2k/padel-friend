/**
 * Run async tasks with at most `limit` in flight. After the first failure no new task starts;
 * in-flight tasks settle before the first error is thrown, so callers' cleanup never races writes.
 * Results keep task order.
 */
export async function runPool<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error('Pool limit must be a positive integer');
  const results = new Array<T>(tasks.length);
  let next = 0;
  let failed = false;
  let firstError: unknown;
  const worker = async () => {
    while (!failed && next < tasks.length) {
      const index = next++;
      try {
        results[index] = await tasks[index]!();
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  if (failed) throw firstError;
  return results;
}
