import { describe, expect, it } from 'vitest';
import {
  AVATAR_MAX_BYTES,
  validateAvatarFile,
  validateAvatarUpload,
  validateInitialLevel,
  validateOnboardPlayer,
  validateUpdatePlayerProfile
} from '../src/features/player/player.validators';

const INVALID_INPUT = 'INVALID_PLAYER_INPUT';
const INVALID_AVATAR = 'INVALID_AVATAR';

describe('display name validation', () => {
  it('accepts a single character', () => {
    expect(
      validateOnboardPlayer({ display_name: 'A', preferred_side: 'EITHER', initial_level: 3 })
        .display_name
    ).toBe('A');
  });

  it('accepts exactly 80 characters', () => {
    const name = 'a'.repeat(80);
    expect(
      validateOnboardPlayer({ display_name: name, preferred_side: 'LEFT', initial_level: 0 })
        .display_name
    ).toBe(name);
  });

  it('rejects 81 characters', () => {
    expect(() =>
      validateOnboardPlayer({
        display_name: 'a'.repeat(81),
        preferred_side: 'LEFT',
        initial_level: 0
      })
    ).toThrow(INVALID_INPUT);
  });

  it('rejects empty and whitespace-only names', () => {
    for (const name of ['', '   ', '\n\t ']) {
      expect(() =>
        validateOnboardPlayer({ display_name: name, preferred_side: 'LEFT', initial_level: 0 })
      ).toThrow(INVALID_INPUT);
    }
  });

  it('trims surrounding whitespace like the SQL btrim check', () => {
    expect(
      validateOnboardPlayer({ display_name: '  Ana  ', preferred_side: 'LEFT', initial_level: 0 })
        .display_name
    ).toBe('Ana');
  });

  it('counts Unicode code points, not UTF-16 code units', () => {
    // '🏓' is one code point but two UTF-16 code units; 40 of them are 80 units long.
    const forty = '🏓'.repeat(40);
    expect(
      validateOnboardPlayer({ display_name: forty, preferred_side: 'LEFT', initial_level: 0 })
        .display_name
    ).toBe(forty);
    // 81 code points are rejected even though JS `.length` reports 162.
    expect(() =>
      validateOnboardPlayer({
        display_name: '🏓'.repeat(81),
        preferred_side: 'LEFT',
        initial_level: 0
      })
    ).toThrow(INVALID_INPUT);
    // 'Ána çğı' is 7 code points; 12 repetitions are 84 code points (over the 80 limit).
    expect(() =>
      validateOnboardPlayer({
        display_name: 'Ána çğı'.repeat(12),
        preferred_side: 'LEFT',
        initial_level: 0
      })
    ).toThrow(INVALID_INPUT);
  });

  it('rejects non-string names', () => {
    for (const name of [null, 42, true, {}, ['Ana']]) {
      expect(() =>
        validateOnboardPlayer({ display_name: name, preferred_side: 'LEFT', initial_level: 0 })
      ).toThrow(INVALID_INPUT);
    }
  });
});

describe('preferred side validation', () => {
  it('accepts exactly LEFT, RIGHT and EITHER', () => {
    for (const side of ['LEFT', 'RIGHT', 'EITHER'] as const) {
      expect(
        validateOnboardPlayer({ display_name: 'Ana', preferred_side: side, initial_level: 3 })
          .preferred_side
      ).toBe(side);
    }
  });

  it('rejects anything else, including case variants', () => {
    for (const side of ['left', 'Right', 'CENTER', '', null, undefined, 1]) {
      expect(() =>
        validateOnboardPlayer({ display_name: 'Ana', preferred_side: side, initial_level: 3 })
      ).toThrow(INVALID_INPUT);
    }
  });
});

describe('initial level validation', () => {
  it('accepts the bounds 0 and 7', () => {
    expect(validateInitialLevel(0)).toBe(0);
    expect(validateInitialLevel(7)).toBe(7);
    expect(validateInitialLevel('0')).toBe(0);
    expect(validateInitialLevel('7')).toBe(7);
  });

  it('accepts tenths inside the range as numbers and decimal strings', () => {
    expect(validateInitialLevel(3.1)).toBe(3.1);
    expect(validateInitialLevel('3.1')).toBe(3.1);
    expect(validateInitialLevel('3.10')).toBe(3.1);
    expect(validateInitialLevel(3.5)).toBe(3.5);
    expect(validateInitialLevel('3')).toBe(3);
  });

  it('rejects out-of-bounds values', () => {
    for (const level of [-0.1, 7.1, 8, -1, '7.1', '-0.1', '8']) {
      expect(() => validateInitialLevel(level)).toThrow(INVALID_INPUT);
    }
  });

  it('rejects values that are not exact tenths', () => {
    for (const level of [3.05, 3.55, 0.01, '3.05', '0.05', 3.123]) {
      expect(() => validateInitialLevel(level)).toThrow(INVALID_INPUT);
    }
  });

  it('rejects NaN, Infinity and non-numeric types', () => {
    for (const level of [NaN, Infinity, -Infinity, '', 'abc', null, undefined, true, {}, []]) {
      expect(() => validateInitialLevel(level)).toThrow(INVALID_INPUT);
    }
  });

  it('returns an RPC-safe exact tenth for every selectable level', () => {
    for (let tenths = 0; tenths <= 70; tenths += 1) {
      const expected = tenths / 10;
      const level = validateInitialLevel(expected.toFixed(1));

      expect(level).toBe(expected);
      expect(JSON.stringify(level)).toBe(JSON.stringify(expected));
      expect(level * 10).toBe(tenths);
    }
  });
});

describe('onboarding payload validation', () => {
  it('accepts a valid payload and normalizes it', () => {
    expect(
      validateOnboardPlayer({
        display_name: ' Ana ',
        preferred_side: 'RIGHT',
        initial_level: '3.5'
      })
    ).toEqual({ display_name: 'Ana', preferred_side: 'RIGHT', initial_level: 3.5 });
  });

  it('rejects extraneous payload-controlled keys', () => {
    expect(() =>
      validateOnboardPlayer({
        display_name: 'Ana',
        preferred_side: 'LEFT',
        initial_level: 3,
        user_id: 'forged'
      })
    ).toThrow(INVALID_INPUT);
    expect(() =>
      validateOnboardPlayer({
        display_name: 'Ana',
        preferred_side: 'LEFT',
        initial_level: 3,
        mu: 3,
        sigma: 1,
        reliability_percent: 99,
        confirmed_competitive_game_groups: 5
      })
    ).toThrow(INVALID_INPUT);
    expect(() =>
      validateOnboardPlayer({
        display_name: 'Ana',
        preferred_side: 'LEFT',
        initial_level: 3,
        avatar_url: 'https://evil.example/a.png'
      })
    ).toThrow(INVALID_INPUT);
  });

  it('rejects non-object payloads', () => {
    for (const payload of [null, 'Ana', 42, ['Ana', 'LEFT', 3]]) {
      expect(() => validateOnboardPlayer(payload)).toThrow(INVALID_INPUT);
    }
  });
});

describe('profile update validation', () => {
  it('accepts each editable field and optional-field nulls', () => {
    expect(validateUpdatePlayerProfile({ display_name: 'Ana' })).toEqual({ display_name: 'Ana' });
    expect(validateUpdatePlayerProfile({ preferred_side: 'EITHER' })).toEqual({
      preferred_side: 'EITHER'
    });
    for (const hand of ['LEFT', 'RIGHT', null] as const) {
      expect(validateUpdatePlayerProfile({ dominant_hand: hand })).toEqual({ dominant_hand: hand });
    }
    expect(validateUpdatePlayerProfile({ bio: null })).toEqual({ bio: null });
    expect(validateUpdatePlayerProfile({ bio: '  hi  ' })).toEqual({ bio: 'hi' });
    expect(validateUpdatePlayerProfile({ avatar_url: null })).toEqual({ avatar_url: null });
    expect(validateUpdatePlayerProfile({ avatar_url: 'u1/a.png' })).toEqual({
      avatar_url: 'u1/a.png'
    });
  });

  it('rejects empty payloads', () => {
    expect(() => validateUpdatePlayerProfile({})).toThrow(INVALID_INPUT);
  });

  it('rejects rating fields, identity fields and unknown keys', () => {
    expect(() => validateUpdatePlayerProfile({ user_id: 'other' })).toThrow(INVALID_INPUT);
    expect(() => validateUpdatePlayerProfile({ display_level: 4 })).toThrow(INVALID_INPUT);
    expect(() => validateUpdatePlayerProfile({ reliability_percent: 50 })).toThrow(INVALID_INPUT);
    expect(() => validateUpdatePlayerProfile({ created_at: '2026-01-01' })).toThrow(INVALID_INPUT);
  });

  it('rejects invalid values for known fields', () => {
    expect(() => validateUpdatePlayerProfile({ preferred_side: 'BOTH' })).toThrow(INVALID_INPUT);
    expect(() => validateUpdatePlayerProfile({ dominant_hand: 'left' })).toThrow(INVALID_INPUT);
    expect(() => validateUpdatePlayerProfile({ dominant_hand: 1 })).toThrow(INVALID_INPUT);
    expect(() => validateUpdatePlayerProfile({ display_name: '' })).toThrow(INVALID_INPUT);
    expect(() => validateUpdatePlayerProfile({ display_name: 'a'.repeat(81) })).toThrow(
      INVALID_INPUT
    );
    expect(() => validateUpdatePlayerProfile({ avatar_url: 5 })).toThrow(INVALID_INPUT);
  });
});

describe('bio length validation', () => {
  it('accepts null and up to 280 characters', () => {
    expect(validateUpdatePlayerProfile({ bio: null }).bio).toBeNull();
    expect(validateUpdatePlayerProfile({ bio: 'a'.repeat(280) }).bio).toHaveLength(280);
  });

  it('rejects 281 characters', () => {
    expect(() => validateUpdatePlayerProfile({ bio: 'a'.repeat(281) })).toThrow(INVALID_INPUT);
  });
});

describe('avatar file validation', () => {
  it('accepts jpeg/png/webp up to 2 MiB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validateAvatarFile({ type, size: AVATAR_MAX_BYTES })).toEqual({
        type,
        size: AVATAR_MAX_BYTES
      });
    }
  });

  it('rejects other MIME types', () => {
    for (const type of ['image/gif', 'text/plain', 'application/pdf', '', undefined, null]) {
      expect(() => validateAvatarFile({ type, size: 10 })).toThrow(INVALID_AVATAR);
    }
  });

  it('rejects sizes over 2 MiB and malformed sizes', () => {
    expect(() => validateAvatarFile({ type: 'image/png', size: AVATAR_MAX_BYTES + 1 })).toThrow(
      INVALID_AVATAR
    );
    expect(() => validateAvatarFile({ type: 'image/png', size: -1 })).toThrow(INVALID_AVATAR);
    expect(() => validateAvatarFile({ type: 'image/png', size: 1.5 })).toThrow(INVALID_AVATAR);
    expect(() => validateAvatarFile({ type: 'image/png', size: NaN })).toThrow(INVALID_AVATAR);
    expect(() => validateAvatarFile({ type: 'image/png', size: '1024' })).toThrow(INVALID_AVATAR);
  });

  it('rejects extraneous keys', () => {
    expect(() => validateAvatarFile({ type: 'image/png', size: 10, user_id: 'forged' })).toThrow(
      INVALID_INPUT
    );
  });
});

describe('avatar finalize validation', () => {
  it('accepts an object key string', () => {
    expect(validateAvatarUpload({ objectKey: 'u1/x.png' })).toEqual({ objectKey: 'u1/x.png' });
  });

  it('rejects missing or non-string keys and extraneous fields', () => {
    expect(() => validateAvatarUpload({})).toThrow(INVALID_INPUT);
    expect(() => validateAvatarUpload({ objectKey: 5 })).toThrow(INVALID_INPUT);
    expect(() => validateAvatarUpload({ objectKey: 'u1/x.png', user_id: 'forged' })).toThrow(
      INVALID_INPUT
    );
  });
});
