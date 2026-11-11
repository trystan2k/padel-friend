// Mark-all-read posts { data: { before } } through TanStack Start's server-function serializer
// (seroval cross-JSON: objects are { t: 10, p: { k: keys, v: values } }, strings { t: 1, s }).
// Matching the exact key and node shape means no other request can be mistaken for the mutation.

export const CUTOFF_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/;

type Node = { t?: unknown; s?: unknown; p?: { k?: unknown; v?: unknown } };

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null;
}

function propertyValue(node: unknown, key: string): unknown {
  if (!isNode(node) || !Array.isArray(node.p?.k) || !Array.isArray(node.p?.v)) return undefined;
  const index = node.p.k.indexOf(key);
  return index === -1 ? undefined : node.p.v[index];
}

function dataNode(postData: string): unknown {
  try {
    const body: unknown = JSON.parse(postData);
    return isNode(body) ? propertyValue(body.t, 'data') : undefined;
  } catch {
    return undefined;
  }
}

/** The mark-all cutoff carried by a serialized server-function body, or null when it is another call. */
export function parseMarkAllCutoff(postData: string): string | null {
  const before = propertyValue(dataNode(postData), 'before');
  return isNode(before) && before.t === 1 && typeof before.s === 'string'
    ? CUTOFF_TIMESTAMP.test(before.s)
      ? before.s
      : null
    : null;
}

/** Payload shape only (data keys, never values) so a failed capture can say what was seen. */
export function describeServerFnPayload(postData: string): string {
  const data = dataNode(postData);
  if (!isNode(data) || !Array.isArray(data.p?.k)) return 'no data object';
  return `data keys [${data.p.k.filter((key) => typeof key === 'string').join(', ')}]`;
}
