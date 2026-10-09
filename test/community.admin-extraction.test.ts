import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const endpointNames = [
  'approveCommunityMember',
  'denyCommunityMember',
  'removeCommunityMember',
  'reactivateCommunityMember',
  'promoteCommunityMember',
  'demoteCommunityMember'
] as const;

describe('admin server-function extraction (production build)', () => {
  it('emits six distinct transport identities for module-level membership actions', () => {
    const assets = readdirSync(new URL('../dist/server/assets/', import.meta.url))
      .filter((file) => /^community-admin\.functions-.*\.js$/.test(file))
      .map((file) =>
        readFileSync(new URL(`../dist/server/assets/${file}`, import.meta.url), 'utf8')
      )
      .filter((content) => content.includes('createServerRpc({'));
    expect(assets).toHaveLength(1);
    const compiled = assets[0]!;
    const ids = endpointNames.map((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = compiled.match(
        new RegExp(
          `var ${escaped}_createServerFn_handler = createServerRpc\\(\\{[\\s\\S]*?id: "([a-f0-9]{64})"`
        )
      );
      expect(match, `${name} must have a compiler-generated transport ID`).not.toBeNull();
      return match?.[1];
    });
    expect(new Set(ids).size).toBe(endpointNames.length);
  });
});
