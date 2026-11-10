/** True when the browser knows it has no connection. `true` from navigator never proves the network works. */
export function isOffline() {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

/**
 * A request that never produced an HTTP response (fetch rejects with a TypeError): the command may
 * or may not have committed. Callers show outcome-unknown feedback, refetch, and never retry blindly.
 */
export function isTransportFailure(error: unknown) {
  return error instanceof TypeError;
}
