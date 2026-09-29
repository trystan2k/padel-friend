import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_FILENAME_PATTERN,
  AVATAR_OBJECT_KEY_PATTERN,
  isAvatarObjectKey
} from '../src/features/player/avatar-key';

const VALIDATORS_SOURCE = readFileSync(
  new URL('../src/features/player/player.validators.ts', import.meta.url),
  'utf8'
);
const SERVER_SOURCE = readFileSync(
  new URL('../src/features/player/player.server.ts', import.meta.url),
  'utf8'
);
const AVATAR_KEY_SOURCE = readFileSync(
  new URL('../src/features/player/avatar-key.ts', import.meta.url),
  'utf8'
);
const MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260928000000_player_profiles_and_ratings.sql', import.meta.url),
  'utf8'
);
// Collapse whitespace so assertions target SQL literals, not line wrapping.
const SQL = MIGRATION.replace(/\s+/g, ' ');

// The single source of truth for the avatar key UUID shape: the version nibble pinned to 4
// and the variant nibble restricted to [89ab]. Every layer that renders or checks an avatar
// key must embed exactly this shape — asserted across the shared module, both consumer
// layers and the migration CHECK below, so they can never drift again.
const PLAIN_UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const V4_UUID = `[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}`;
const AVATAR_EXTENSION = '\\.(?:jpg|jpeg|png|webp)';

const CANONICAL_KEY_BASE =
  '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';
const CANONICAL_KEY = `${CANONICAL_KEY_BASE}.png`;

describe('avatar object-key shared pattern module contract', () => {
  it('pins the v4 version and [89ab] variant nibbles in both exported patterns', () => {
    // RegExp.source escapes the path separator as \/.
    expect(AVATAR_OBJECT_KEY_PATTERN.source).toBe(
      `^${PLAIN_UUID}\\/${V4_UUID}${AVATAR_EXTENSION}$`
    );
    expect(AVATAR_OBJECT_KEY_PATTERN.flags).toContain('i');
    expect(AVATAR_FILENAME_PATTERN.source).toBe(`^${V4_UUID}${AVATAR_EXTENSION}$`);
    expect(AVATAR_FILENAME_PATTERN.flags).toContain('i');
  });

  it('accepts a canonical v4 key plus case variants, rejects non-v4 and malformed keys', () => {
    expect(isAvatarObjectKey(CANONICAL_KEY)).toBe(true);
    // Case-insensitive: uppercase hex digits and extension letters are accepted too.
    expect(isAvatarObjectKey(CANONICAL_KEY.toUpperCase())).toBe(true);
    expect(isAvatarObjectKey(`${CANONICAL_KEY_BASE}.PnG`)).toBe(true);
    // Version nibble 3 and variant nibble c sit outside the v4+variant shape.
    expect(
      isAvatarObjectKey(
        '11111111-1111-4111-8111-111111111111/22222222-2222-3222-8222-222222222222.png'
      )
    ).toBe(false);
    expect(
      isAvatarObjectKey(
        '11111111-1111-4111-8111-111111111111/22222222-2222-4222-c222-222222222222.png'
      )
    ).toBe(false);
    expect(
      isAvatarObjectKey(
        '11111111-1111-4111-8111-111111111111/nested/22222222-2222-4222-8222-222222222222.png'
      )
    ).toBe(false);
    expect(isAvatarObjectKey(`${CANONICAL_KEY_BASE}.gif`)).toBe(false);
  });
});

describe('avatar object-key no-drift contract between the client and server layers', () => {
  it('is the ONLY place the avatar UUID shape is declared — consumers import it, never re-declare it', () => {
    expect(AVATAR_KEY_SOURCE).toContain(V4_UUID);
    for (const [name, source] of [
      ['player.validators.ts', VALIDATORS_SOURCE],
      ['player.server.ts', SERVER_SOURCE]
    ] as const) {
      expect(source, `${name} must import from the shared avatar-key module`).toContain(
        "from './avatar-key'"
      );
      // Any inline re-declaration of the UUID hex classes or the variant nibble set would
      // let the two layers drift; the shared module owns the shape exclusively.
      expect(source, `${name} must not re-declare an inline avatar UUID regex`).not.toContain(
        '[0-9a-f]{8}'
      );
      expect(source, `${name} must not re-declare the variant nibble class`).not.toContain(
        '[89ab]'
      );
    }
    // Each layer uses the export it actually needs.
    expect(VALIDATORS_SOURCE).toContain('isAvatarObjectKey');
    expect(SERVER_SOURCE).toContain('AVATAR_FILENAME_PATTERN');
  });
});

describe('avatar object-key ↔ migration SQL contract', () => {
  it('anchors the avatar_url CHECK with an exact, case-sensitive owner-prefix equality', () => {
    // The owner prefix is compared with `=`, never `~*`: an uppercased owner UUID must fail
    // the anchor even though the filename part stays case-insensitive.
    expect(SQL).toContain(
      "left(avatar_url, char_length(user_id::text) + 1) = user_id::text || '/'"
    );
  });

  it('matches the v4+variant filename shape case-insensitively on the owner-relative remainder only', () => {
    // Collapsed literal: substring(avatar_url from char_length(user_id::text) + 2) ~*
    // '<v4>\.(jpg|jpeg|png|webp)$' — the same shared v4+variant shape, scoped to the
    // substring after the owner prefix.
    expect(SQL).toContain(
      `substring(avatar_url from char_length(user_id::text) + 2) ~* '^${V4_UUID}\\.(jpg|jpeg|png|webp)$'`
    );
    // Negative regression guard: the whole-key comparison is NOT the case-insensitive form.
    // The old monolithic `avatar_url ~* ( '^' || user_id::text || … )` must stay gone so the
    // owner prefix can never be matched with `~*` again; the single `~*` left in the
    // migration is exactly the remainder match asserted above.
    expect(SQL).not.toContain('avatar_url ~*');
    expect(SQL.match(/~\*/g)).toHaveLength(1);
  });

  it('keeps NULL allowed and the 256-char bound in the same CHECK', () => {
    expect(SQL).toContain('avatar_url is null or ( char_length(avatar_url) <= 256');
  });

  it('has exactly one extension alternation and it directly follows the v4 shape', () => {
    const extensionAt = SQL.indexOf('\\.(jpg|jpeg|png|webp)$');
    expect(extensionAt).toBeGreaterThan(-1);
    expect(SQL.slice(extensionAt - V4_UUID.length, extensionAt)).toBe(V4_UUID);
    // No unversioned (non-v4) uuid+extension shape may linger anywhere in the migration.
    expect(SQL).not.toContain(`${PLAIN_UUID}\\.(jpg|jpeg|png|webp)$`);
  });

  it('keeps the storage.buckets seed re-applicable with on conflict (id) do update', () => {
    expect(SQL).toContain(
      'insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)'
    );
    expect(SQL).toContain(
      'on conflict (id) do update set public = excluded.public, ' +
        'file_size_limit = excluded.file_size_limit, ' +
        'allowed_mime_types = excluded.allowed_mime_types'
    );
  });
});
