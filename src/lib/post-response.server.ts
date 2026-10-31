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
 * starts only after registration and one further macrotask, i.e. after the handler that
 * called this has returned its response. Outside Workers the gated promise simply runs
 * detached. The task's failures are its own business: they never reach the caller.
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
