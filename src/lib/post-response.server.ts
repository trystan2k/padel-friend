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
 * Runs `task` after the response, so its duration (and which branch it took) never
 * shapes response latency. The returned promise settles once the task is REGISTERED
 * (on Workers: handed to the request's `waitUntil`, which keeps the isolate alive until
 * the task settles) and never waits for the task itself. The task body is gated: it
 * starts only after registration and one further macrotask, i.e. off the handler's
 * stack. Outside Workers the gated promise simply runs detached. The task's failures are
 * its own business: they never reach the caller.
 *
 * Limitation: Workers exposes no response-finished signal. `waitUntil` extends the
 * isolate's lifetime past the response but does not guarantee the task starts after the
 * response was fully sent, so the task may overlap response work still in flight (for
 * example photo signing). That contention is bounded and branch-independent: the task
 * does the same work whatever the address resolved to.
 */
export function afterResponse(task: () => Promise<unknown>): Promise<void> {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const running = gate.then(task).catch(() => undefined);
  const registered = import(/* @vite-ignore */ WORKERS_MODULE)
    .then((workers: unknown) => {
      if (isWorkersModule(workers)) workers.waitUntil(running);
    })
    .catch(() => undefined);
  void registered.then(() => setTimeout(open, 0));
  return registered;
}
