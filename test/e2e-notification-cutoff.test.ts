import { describe, expect, it } from 'vitest';
import {
  CUTOFF_TIMESTAMP,
  describeServerFnPayload,
  parseMarkAllCutoff
} from '../e2e/notification-cutoff';

// Bodies produced by seroval's toJSONAsync (the serializer behind the real server-function client).
const cutoff = '2026-11-11T10:20:30.123456+00:00';
const markAll = `{"t":{"t":10,"i":0,"p":{"k":["data"],"v":[{"t":10,"i":1,"p":{"k":["before"],"v":[{"t":1,"s":"${cutoff}"}]},"o":0}]},"o":0},"f":127,"m":[]}`;
const markOne =
  '{"t":{"t":10,"i":0,"p":{"k":["data"],"v":[{"t":10,"i":1,"p":{"k":["notificationId"],"v":[{"t":1,"s":"8b7c2c3e-0000-4000-8000-000000000000"}]},"o":0}]},"o":0},"f":127,"m":[]}';

describe('parseMarkAllCutoff', () => {
  it('returns the microsecond cutoff of the mark-all payload', () => {
    expect(parseMarkAllCutoff(markAll)).toBe(cutoff);
    expect(CUTOFF_TIMESTAMP.test(cutoff)).toBe(true);
  });

  it('ignores other server-function calls and timestamps outside the before key', () => {
    expect(parseMarkAllCutoff(markOne)).toBeNull();
    expect(parseMarkAllCutoff(markAll.replace('"before"', '"createdAt"'))).toBeNull();
    expect(parseMarkAllCutoff(markAll.replace(/"before"/, '"notBefore"'))).toBeNull();
  });

  it('rejects empty, malformed, non-string and non-timestamp values', () => {
    expect(parseMarkAllCutoff('')).toBeNull();
    expect(parseMarkAllCutoff('not json')).toBeNull();
    expect(parseMarkAllCutoff('{"t":null}')).toBeNull();
    expect(parseMarkAllCutoff(markAll.replace(`"t":1,"s":"${cutoff}"`, '"t":0,"s":1'))).toBeNull();
    expect(parseMarkAllCutoff(markAll.replace(cutoff, 'yesterday'))).toBeNull();
  });
});

describe('describeServerFnPayload', () => {
  it('lists data keys without exposing values', () => {
    expect(describeServerFnPayload(markAll)).toBe('data keys [before]');
    expect(describeServerFnPayload(markAll)).not.toContain(cutoff);
    expect(describeServerFnPayload(markOne)).toBe('data keys [notificationId]');
  });

  it('reports unparseable bodies', () => {
    expect(describeServerFnPayload('')).toBe('no data object');
    expect(describeServerFnPayload('{"t":null}')).toBe('no data object');
  });
});
