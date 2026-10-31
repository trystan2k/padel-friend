// `cloudflare:workers` only exists inside workerd; keeping the specifier out of the
// static graph lets Node (unit tests, tooling) load this module and fall back.
const WORKERS_MODULE = 'cloudflare:workers';

type WorkersModule = { waitUntil: (promise: Promise<unknown>) => void };

function isWorkersModule(value: unknown): value is WorkersModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'waitUntil') === 'function'
  );
}

/**
 * Runs `task` after the response was sent, so its duration (and which branch it took)
 * never shapes response latency. On Workers it is registered with the request's
 * `waitUntil`, which keeps the isolate alive until the task settles; elsewhere it runs
 * detached. The task's failures are its own business: they never reach the caller.
 */
export async function afterResponse(task: () => Promise<unknown>): Promise<void> {
  const running = Promise.resolve()
    .then(task)
    .catch(() => undefined);
  try {
    const workers: unknown = await import(/* @vite-ignore */ WORKERS_MODULE);
    if (isWorkersModule(workers)) workers.waitUntil(running);
  } catch {
    // Not on Workers: the detached promise above is all there is.
  }
}
