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

// Storage object keys are "<owner uuid>/<object uuid>.<ext>". The owner uuid here is just a
// well-formed prefix: proving the USER prefix belongs to nobody is the point — ownership is
// verified by the server function, not the validator.
const USER_ID = '11111111-1111-4111-8111-111111111111';
const OBJECT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';
const avatarKey = (extension = 'png', objectId = OBJECT_ID, userId = USER_ID) =>
  `${userId}/${objectId}.${extension}`;

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

  it('rejects any edge ASCII whitespace (space, tab, LF, CR, FF, VT) like the SQL btrim class', () => {
    for (const name of [
      ' Ana',
      'Ana ',
      '\tAna',
      'Ana\t',
      '\nAna',
      'Ana\n',
      '\rAna',
      'Ana\r',
      '\fAna',
      'Ana\f',
      '\vAna',
      'Ana\v',
      '  Ana  '
    ]) {
      expect(() =>
        validateOnboardPlayer({ display_name: name, preferred_side: 'LEFT', initial_level: 0 })
      ).toThrow(INVALID_INPUT);
    }
  });

  it('accepts internal ASCII whitespace unchanged, like the SQL btrim check', () => {
    for (const name of ['Ana Lee', 'Ana\tLee', 'Ana\nLee']) {
      expect(
        validateOnboardPlayer({ display_name: name, preferred_side: 'LEFT', initial_level: 0 })
          .display_name
      ).toBe(name);
    }
  });

  it('accepts Unicode whitespace at the edges — the documented V1 policy, matching the SQL class', () => {
    // V1 normalizes only the ASCII class E' \t\n\r\f\v': an NBSP (U+00A0) edge is in neither
    // the SQL btrim class nor the TS validator's pattern, so BOTH layers accept and preserve
    // it verbatim. This encodes the intended policy, not a bug.
    const name = '\u00A0Ana\u00A0';
    expect(
      validateOnboardPlayer({ display_name: name, preferred_side: 'LEFT', initial_level: 0 })
        .display_name
    ).toBe(name);
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
  it('accepts a valid payload and normalizes the level string', () => {
    // V1 ASCII policy: display names must arrive edge-clean — the server rejects (not trims)
    // edge ASCII whitespace, so only the level string is normalized here.
    expect(
      validateOnboardPlayer({
        display_name: 'Ana',
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
    expect(validateUpdatePlayerProfile({ avatar_url: avatarKey() })).toEqual({
      avatar_url: avatarKey()
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
    // Same ASCII edge-whitespace policy as onboarding: the update path rejects it too.
    expect(() => validateUpdatePlayerProfile({ display_name: ' Ana ' })).toThrow(INVALID_INPUT);
    expect(() => validateUpdatePlayerProfile({ display_name: 'a'.repeat(81) })).toThrow(
      INVALID_INPUT
    );
    expect(() => validateUpdatePlayerProfile({ avatar_url: 5 })).toThrow(INVALID_INPUT);
  });
});

describe('avatar_url object key validation', () => {
  it('accepts a well-formed <uuid>/<uuid>.<ext> key and trims surrounding whitespace', () => {
    expect(validateUpdatePlayerProfile({ avatar_url: `  ${avatarKey()}  ` })).toEqual({
      avatar_url: avatarKey()
    });
  });

  it('accepts every supported extension in any letter case', () => {
    for (const extension of ['png', 'PNG', 'jpg', 'JPG', 'jpeg', 'Jpg', 'webp', 'WebP']) {
      expect(validateUpdatePlayerProfile({ avatar_url: avatarKey(extension) }).avatar_url).toBe(
        avatarKey(extension)
      );
    }
  });

  it('accepts any well-formed user prefix — ownership verification stays the server function job', () => {
    const foreignKey = avatarKey('png', OBJECT_ID, OTHER_USER_ID);
    expect(validateUpdatePlayerProfile({ avatar_url: foreignKey })).toEqual({
      avatar_url: foreignKey
    });
  });

  it('keeps absent and null avatar_url untouched', () => {
    expect(validateUpdatePlayerProfile({ avatar_url: null })).toEqual({ avatar_url: null });
    expect(validateUpdatePlayerProfile({ display_name: 'Ana' })).not.toHaveProperty('avatar_url');
  });

  it('rejects empty and whitespace-only values', () => {
    for (const value of ['', '   ', '\t\n']) {
      expect(() => validateUpdatePlayerProfile({ avatar_url: value })).toThrow(INVALID_INPUT);
    }
  });

  it('rejects bare filenames and wrong-prefix shapes, including the old permissive shape', () => {
    for (const value of [
      'a.png',
      'u1/a.png',
      `/${OBJECT_ID}.png`,
      `${USER_ID}/folder/${OBJECT_ID}.png`,
      `${USER_ID}/${OBJECT_ID}.png/`,
      `${USER_ID}/${OBJECT_ID}`
    ]) {
      expect(() => validateUpdatePlayerProfile({ avatar_url: value })).toThrow(INVALID_INPUT);
    }
  });

  it('rejects unsupported extensions', () => {
    for (const extension of ['gif', 'txt', 'avif']) {
      expect(() => validateUpdatePlayerProfile({ avatar_url: avatarKey(extension) })).toThrow(
        INVALID_INPUT
      );
    }
  });

  it('accepts a canonical v4 object UUID with every legal variant nibble [89ab]', () => {
    for (const variant of ['8', '9', 'a', 'b']) {
      const key = avatarKey('png', `22222222-2222-4222-${variant}222-222222222222`);
      expect(validateUpdatePlayerProfile({ avatar_url: key }).avatar_url).toBe(key);
    }
  });

  it('accepts uppercase hex UUIDs and mixed-case extensions (case-insensitive)', () => {
    const key = avatarKey('PnG', OBJECT_ID.toUpperCase(), USER_ID.toUpperCase());
    expect(validateUpdatePlayerProfile({ avatar_url: key }).avatar_url).toBe(key);
  });

  it('rejects object UUIDs whose version nibble is not 4', () => {
    for (const version of '012356789abcdef') {
      const key = avatarKey('png', `22222222-2222-${version}222-8222-222222222222`);
      expect(() => validateUpdatePlayerProfile({ avatar_url: key })).toThrow(INVALID_INPUT);
    }
  });

  it('rejects object UUIDs whose variant nibble is outside [89ab]', () => {
    for (const variant of '01234567cdef') {
      const key = avatarKey('png', `22222222-2222-4222-${variant}222-222222222222`);
      expect(() => validateUpdatePlayerProfile({ avatar_url: key })).toThrow(INVALID_INPUT);
    }
  });

  it('rejects nested or extra path segments beyond <user>/<file>', () => {
    for (const key of [
      `${USER_ID}/nested/${OBJECT_ID}.png`,
      `${USER_ID}/${OBJECT_ID}/nested.png`,
      `${USER_ID}/${OBJECT_ID}/nested/${OBJECT_ID}.png`
    ]) {
      expect(() => validateUpdatePlayerProfile({ avatar_url: key })).toThrow(INVALID_INPUT);
    }
  });

  it('rejects non-string values', () => {
    for (const value of [5, true, {}, ['a.png']]) {
      expect(() => validateUpdatePlayerProfile({ avatar_url: value })).toThrow(INVALID_INPUT);
    }
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

  it('trims surrounding whitespace BEFORE enforcing the 280 limit, so padding cannot smuggle a 281st character', () => {
    expect(validateUpdatePlayerProfile({ bio: '  padded bio  ' }).bio).toBe('padded bio');
    expect(validateUpdatePlayerProfile({ bio: `  ${'a'.repeat(280)}  ` }).bio).toHaveLength(280);
    expect(() => validateUpdatePlayerProfile({ bio: ` ${'a'.repeat(281)} ` })).toThrow(
      INVALID_INPUT
    );
  });

  it('accepts a whitespace-only bio as an empty string — bio has no emptiness rule, unlike display names', () => {
    expect(validateUpdatePlayerProfile({ bio: '   ' }).bio).toBe('');
    expect(validateUpdatePlayerProfile({ bio: '\t\n' }).bio).toBe('');
  });

  it('counts Unicode code points, not UTF-16 code units', () => {
    // '🏓' is one code point but two UTF-16 code units: 280 of them report a JS .length of
    // 560 yet stay inside the 280 code-point limit.
    expect(validateUpdatePlayerProfile({ bio: '🏓'.repeat(280) }).bio).toBe('🏓'.repeat(280));
    expect(() => validateUpdatePlayerProfile({ bio: '🏓'.repeat(281) })).toThrow(INVALID_INPUT);
  });

  it('rejects non-string bios', () => {
    for (const bio of [42, true, {}, ['bio']]) {
      expect(() => validateUpdatePlayerProfile({ bio })).toThrow(INVALID_INPUT);
    }
  });

  it('applies the same trim-then-limit and null handling to the onboarding payload bio', () => {
    expect(
      validateOnboardPlayer({
        display_name: 'Ana',
        preferred_side: 'LEFT',
        initial_level: 3,
        bio: '  padded onboarding bio  '
      }).bio
    ).toBe('padded onboarding bio');
    expect(
      validateOnboardPlayer({
        display_name: 'Ana',
        preferred_side: 'LEFT',
        initial_level: 3,
        bio: null
      }).bio
    ).toBeNull();
    // An absent bio stays absent: the payload never carries a fabricated empty string.
    expect(
      validateOnboardPlayer({ display_name: 'Ana', preferred_side: 'LEFT', initial_level: 3 })
    ).not.toHaveProperty('bio');
    expect(() =>
      validateOnboardPlayer({
        display_name: 'Ana',
        preferred_side: 'LEFT',
        initial_level: 3,
        bio: 'a'.repeat(281)
      })
    ).toThrow(INVALID_INPUT);
    expect(() =>
      validateOnboardPlayer({
        display_name: 'Ana',
        preferred_side: 'LEFT',
        initial_level: 3,
        bio: 42
      })
    ).toThrow(INVALID_INPUT);
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
