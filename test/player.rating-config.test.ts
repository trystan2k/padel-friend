import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatDisplayLevel,
  INITIAL_CONFIRMED_COMPETITIVE_GAME_GROUPS,
  INITIAL_RELIABILITY_PERCENT,
  INITIAL_SIGMA,
  LEVEL_STEP,
  MAX_LEVEL,
  MIN_LEVEL,
  RATING_ENGINE,
  RATING_ENGINE_VERSION
} from '../src/features/player/rating-config';
import { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES } from '../src/features/player/player.validators';

const MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260928000000_player_profiles_and_ratings.sql', import.meta.url),
  'utf8'
);
// Collapse whitespace so assertions target SQL literals, not line wrapping.
const SQL = MIGRATION.replace(/\s+/g, ' ');
// There is exactly ONE player migration — asserted by the migration-count contract below —
// and the display-name whitespace tightening was folded into the base migration, so every
// assertion below targets its effective final state, including the onboard_player body,
// not just its signature.

describe('rating config constants', () => {
  it('holds the v1 mapping values', () => {
    expect(INITIAL_SIGMA).toBe(1);
    expect(INITIAL_RELIABILITY_PERCENT).toBe(10);
    expect(INITIAL_CONFIRMED_COMPETITIVE_GAME_GROUPS).toBe(0);
    expect(RATING_ENGINE).toBe('app-wide-level');
    expect(RATING_ENGINE_VERSION).toBe('1.0.0');
    expect(MIN_LEVEL).toBe(0);
    expect(MAX_LEVEL).toBe(7);
    expect(LEVEL_STEP).toBe(0.1);
  });

  it('formats display levels with exactly two decimals', () => {
    expect(formatDisplayLevel(0)).toBe('0.00');
    expect(formatDisplayLevel(7)).toBe('7.00');
    expect(formatDisplayLevel(3.1)).toBe('3.10');
    expect(formatDisplayLevel(3.5)).toBe('3.50');
    expect(formatDisplayLevel(2.25)).toBe('2.25');
  });
});

describe('rating config ↔ migration SQL contract', () => {
  it('enumerates the migrations and keeps exactly one player migration', () => {
    const migrationFiles = readdirSync(new URL('../supabase/migrations', import.meta.url));
    const playerMigrations = migrationFiles.filter((file) => file.includes('player_profile'));
    // Count plus exact filename: a second player migration or a renamed base file fails here.
    expect(playerMigrations).toHaveLength(1);
    expect(playerMigrations[0]).toBe('20260928000000_player_profiles_and_ratings.sql');
    // The display-name follow-up was folded into the base migration and must stay deleted.
    expect(migrationFiles).not.toContain(
      '20260928010000_player_profile_display_name_whitespace.sql'
    );
  });

  it('seeds the rating row with the same constants the engine declares', () => {
    const expectedSeed =
      `values (v_user_id, p_initial_level, p_initial_level, ${INITIAL_SIGMA.toFixed(2)}, p_initial_level, ` +
      `${INITIAL_RELIABILITY_PERCENT}, ${INITIAL_CONFIRMED_COMPETITIVE_GAME_GROUPS}, p_initial_level, ` +
      `'${RATING_ENGINE}', '${RATING_ENGINE_VERSION}')`;
    expect(SQL).toContain(expectedSeed);
  });

  it('seeds the rating row inside the effective onboard_player body, not just beside the signature', () => {
    // The seed insert must live in the single migration's RPC body so the declared
    // five-argument function is the one producing the initial rating row.
    expect(SQL.indexOf('create function public.onboard_player')).toBeLessThan(
      SQL.indexOf('insert into public.global_player_ratings')
    );
  });

  it('bounds the level columns to MIN_LEVEL..MAX_LEVEL', () => {
    expect(SQL).toContain(
      `initial_display_level between ${MIN_LEVEL.toFixed(1)} and ${MAX_LEVEL.toFixed(1)}`
    );
    expect(SQL).toContain(`mu between ${MIN_LEVEL.toFixed(2)} and ${MAX_LEVEL.toFixed(2)}`);
    expect(SQL).toContain(`sigma > ${MIN_LEVEL.toFixed(2)} and sigma <= ${MAX_LEVEL.toFixed(2)}`);
    expect(SQL).toContain(
      `display_level between ${MIN_LEVEL.toFixed(2)} and ${MAX_LEVEL.toFixed(2)}`
    );
    expect(SQL).toContain(
      `highest_display_level between ${MIN_LEVEL.toFixed(2)} and ${MAX_LEVEL.toFixed(2)}`
    );
  });

  it('enforces the 0.1 tenth step on the RPC input', () => {
    expect(SQL).toContain('p_initial_level * 10 <> pg_catalog.trunc(p_initial_level * 10)');
  });

  it('keeps reliability and confirmed-group bounds compatible with the seed', () => {
    expect(SQL).toContain('reliability_percent between 0 and 100');
    expect(SQL).toContain('confirmed_competitive_game_groups >= 0');
  });

  it('matches the avatar bucket limits with the shared validator constants', () => {
    expect(SQL).toContain(
      `values ('player-avatars', 'player-avatars', false, ${AVATAR_MAX_BYTES},`
    );
    expect(SQL).toContain(`array[${AVATAR_MIME_TYPES.map((mime) => `'${mime}'`).join(',')}]`);
  });

  it('defines the tables and RPC the server functions rely on', () => {
    expect(SQL).toContain('create table public.player_profiles');
    expect(SQL).toContain('create table public.global_player_ratings');
    expect(SQL).toContain('create function public.onboard_player');
    // The five-argument signature carries the optional hand/bio that land in the same
    // transaction as the profile and rating rows.
    expect(SQL).toContain(
      'revoke all on function public.onboard_player(text, text, numeric, text, text) from public, anon'
    );
    expect(SQL).toContain(
      'grant execute on function public.onboard_player(text, text, numeric, text, text) to authenticated'
    );
  });

  it('validates the optional hand and bio on the RPC input like the TS validator', () => {
    // Hand: exactly LEFT/RIGHT when supplied (player.validators dominant-hand check).
    expect(SQL).toContain(
      "p_dominant_hand is not null and p_dominant_hand not in ('LEFT','RIGHT')"
    );
    expect(SQL).toContain("dominant_hand text check (dominant_hand in ('LEFT', 'RIGHT'))");
    // Bio: at most 280 characters when supplied (player.validators bio bound).
    expect(SQL).toContain('p_bio is not null and char_length(p_bio) > 280');
    expect(SQL).toContain('bio text check (char_length(bio) <= 280)');
  });
});

describe('display name whitespace policy (single player migration)', () => {
  // Same ASCII whitespace class the TS validator rejects at the edges: space, tab, LF, CR, FF, VT.
  const WHITESPACE_CLASS = "E' \\t\\n\\r\\f\\v'";

  it('defines the display name CHECK inline with the 1..80 bounds over the ASCII whitespace class', () => {
    expect(SQL).toContain(`char_length(btrim(display_name, ${WHITESPACE_CLASS})) between 1 and 80`);
    expect(SQL).toContain(`and display_name = btrim(display_name, ${WHITESPACE_CLASS})`);
  });

  it('keeps the five-argument onboard_player signature and applies the same whitespace rule to the RPC input', () => {
    expect(SQL).toContain(
      'create function public.onboard_player(p_display_name text, p_preferred_side text, ' +
        'p_initial_level numeric, p_dominant_hand text default null, p_bio text default null)'
    );
    expect(SQL).toContain(
      `p_display_name is null or char_length(pg_catalog.btrim(p_display_name, ${WHITESPACE_CLASS})) not between 1 and 80`
    );
    expect(SQL).toContain(
      `p_display_name <> pg_catalog.btrim(p_display_name, ${WHITESPACE_CLASS})`
    );
  });
});
