import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

// Extracts the POSIX pattern of the endpoint table constraint; the subset used is JS-regex compatible.
const constraintRegex = (sql: string) => {
  const match = /endpoint ~ '([^']+)'/.exec(sql);
  if (!match) throw new Error('endpoint constraint not found');
  return new RegExp(match[1]!.replaceAll('[:space:]', '\\s'));
};

const oldPattern = constraintRegex(migration('20261108090000_push_subscriptions.sql'));
const newPattern = constraintRegex(
  migration('20261115130000_push_endpoint_and_openapi_hardening.sql')
);

// Forms the previous constraint accepted: re-adding the constraint must keep every one valid.
const oldAcceptedForms = [
  'https://?abcdefghijklmnop',
  'https://?abcdefghijklmnop/path',
  'https://host.example?token=abcdefghij',
  'https://host.example?x/path?y',
  'https://fcm.googleapis.com/fcm/send/abcdefghij',
  'https://fcm.googleapis.com:443/send/a?key=abc',
  'https://host.example/a?b=c@d'
];

describe('push_subscriptions endpoint constraint', () => {
  it.each(oldAcceptedForms)('old grammar accepts %s', (endpoint) => {
    expect(oldPattern.test(endpoint)).toBe(true);
  });

  it.each(oldAcceptedForms)('new grammar is a superset: still accepts %s', (endpoint) => {
    expect(newPattern.test(endpoint)).toBe(true);
  });

  it('still ends the authority at "?" so "@" in a query stays ordinary text', () => {
    expect(newPattern.test('https://fcm.googleapis.com?token=a@b')).toBe(true);
  });

  it.each(['http://a.example/abcdefghij', 'https://u@host.example/abcdefghij', 'https://'])(
    'still rejects %s',
    (endpoint) => {
      expect(newPattern.test(endpoint)).toBe(false);
    }
  );
});
