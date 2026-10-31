import { describe, expect, it } from 'vitest';
import { ADD_PLAYER_ERROR_COPY } from '../src/features/matches/match-add-player-error-copy';
import {
  firstInvalidField,
  validateAddPlayerForm
} from '../src/features/matches/match-add-player-form';
import { ADD_MATCH_PLAYER_ERROR_CODES } from '../src/features/matches/match-add-player-model';
import { validateAddMatchPlayer } from '../src/features/matches/match-add-player.validators';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import pt from '../src/locales/pt-BR/translation.json';

const valid = { name: '  Marta Silva ', email: '  Marta@Example.COM ', level: '3.5' };

describe('add-player client validation', () => {
  it('normalizes like the server', () => {
    const result = validateAddPlayerForm(valid);
    expect(result).toEqual({
      ok: true,
      value: { display_name: 'Marta Silva', email: 'marta@example.com', estimated_level: 3.5 }
    });
    // Same rules, same output as the server validator.
    const server = validateAddMatchPlayer({
      event_id: '11111111-1111-4111-8111-111111111111',
      display_name: valid.name,
      email: valid.email,
      estimated_level: 3.5,
      locale: 'en',
      request_id: '22222222-2222-4222-8222-222222222222'
    });
    expect(result.ok && result.value).toMatchObject({
      display_name: server.display_name,
      email: server.email,
      estimated_level: server.estimated_level
    });
  });

  it('keeps dots and plus tags in the email', () => {
    const result = validateAddPlayerForm({ ...valid, email: 'A.B+tag@Example.com' });
    expect(result.ok && result.value.email).toBe('a.b+tag@example.com');
  });

  it('reports every invalid field with a translation key, in focus order', () => {
    const result = validateAddPlayerForm({ name: '   ', email: 'nope', level: null });
    expect(result).toEqual({
      ok: false,
      errors: {
        name: 'matches.addPlayer.validation.name',
        email: 'matches.addPlayer.validation.email',
        level: 'matches.addPlayer.validation.level'
      }
    });
    expect(result.ok ? null : firstInvalidField(result.errors)).toBe('name');
    expect(firstInvalidField({ level: 'x' })).toBe('level');
    expect(firstInvalidField({})).toBeNull();
  });

  it.each([
    ['0', true],
    ['7', true],
    ['7.0', true],
    ['0.1', true],
    ['7.1', false],
    ['-0.1', false],
    ['3.55', false],
    ['NaN', false],
    ['Infinity', false],
    ['', false]
  ])('level %j valid=%s', (level, ok) => {
    expect(validateAddPlayerForm({ ...valid, level }).ok).toBe(ok);
  });

  it('bounds name length at 80 code points and rejects malformed emails', () => {
    expect(validateAddPlayerForm({ ...valid, name: 'x'.repeat(80) }).ok).toBe(true);
    expect(validateAddPlayerForm({ ...valid, name: 'x'.repeat(81) }).ok).toBe(false);
    for (const email of ['', 'a@b', '@b.co', 'a b@c.co', `${'a'.repeat(250)}@b.co`])
      expect(validateAddPlayerForm({ ...valid, email }).ok).toBe(false);
  });
});

describe('add-player copy contract', () => {
  const paths = (value: unknown, prefix = ''): string[] =>
    value !== null && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, child]) => paths(child, `${prefix}${key}.`))
      : [prefix.slice(0, -1)];

  it('maps every stable server code to a message in en, pt-BR and es', () => {
    expect(Object.keys(ADD_PLAYER_ERROR_COPY).sort()).toEqual(
      [...ADD_MATCH_PLAYER_ERROR_CODES].sort()
    );
    const lookup = (tree: unknown, key: string) =>
      key
        .split('.')
        .reduce<unknown>(
          (node, part) =>
            node !== null && typeof node === 'object' ? Reflect.get(node, part) : undefined,
          tree
        );
    for (const tree of [en, pt, es]) {
      for (const key of Object.values(ADD_PLAYER_ERROR_COPY))
        expect(typeof lookup(tree, key)).toBe('string');
      for (const field of ['name', 'email', 'level'])
        expect(typeof lookup(tree, `matches.addPlayer.validation.${field}`)).toBe('string');
    }
  });

  it('keeps addPlayer and provisional key parity across locales', () => {
    const slice = (tree: typeof en) =>
      [...paths(tree.matches.addPlayer), ...paths(tree.player.provisional)].sort();
    expect(slice(pt)).toEqual(slice(en));
    expect(slice(es)).toEqual(slice(en));
  });

  it('keeps the interpolation contract and never mentions account state in success copy', () => {
    for (const tree of [en, pt, es]) {
      expect(tree.matches.addPlayer.success).toContain('{{name}}');
      expect(tree.matches.addPlayer.success).not.toMatch(/\{\{email\}\}/);
    }
  });
});
