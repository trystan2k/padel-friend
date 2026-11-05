import { describe, expect, it } from 'vitest';
import {
  decimalSeparator,
  exampleLevel,
  isActiveLevelReview,
  levelReviewErrorKind,
  levelReviewFingerprint,
  levelReviewShortId,
  parseLevelInput,
  validateLevelReviewForm,
  type LevelReviewFormValues
} from '../src/features/level-reviews/level-review-form';
import { LEVEL_REVIEW_STATUSES } from '../src/features/level-reviews/level-review-contracts';
import { validateSubmitLevelReview } from '../src/features/level-reviews/level-review-validators';

const form = (overrides: Partial<LevelReviewFormValues> = {}): LevelReviewFormValues => ({
  mode: 'exact',
  exact: '3.8',
  min: '',
  max: '',
  reason: 'Because',
  evidence: '',
  ...overrides
});

describe('parseLevelInput', () => {
  it('uses each locale decimal separator and returns canonical numbers', () => {
    expect(decimalSeparator('en')).toBe('.');
    expect(decimalSeparator('pt-BR')).toBe(',');
    expect(decimalSeparator('es')).toBe(',');
    expect(parseLevelInput('3.8', 'en')).toEqual({ ok: true, value: 3.8 });
    expect(parseLevelInput('3,8', 'pt-BR')).toEqual({ ok: true, value: 3.8 });
    expect(parseLevelInput(' 4,25 ', 'es')).toEqual({ ok: true, value: 4.25 });
    expect(parseLevelInput('4', 'en')).toEqual({ ok: true, value: 4 });
    expect(parseLevelInput('0', 'en')).toEqual({ ok: true, value: 0 });
    expect(parseLevelInput('7.00', 'en')).toEqual({ ok: true, value: 7 });
  });

  it('never guesses a thousands separator or the other locale convention', () => {
    expect(parseLevelInput('3,8', 'en')).toEqual({ ok: false, error: 'format' });
    expect(parseLevelInput('3.8', 'pt-BR')).toEqual({ ok: false, error: 'format' });
    expect(parseLevelInput('1.000,5', 'pt-BR')).toEqual({ ok: false, error: 'format' });
    expect(parseLevelInput('1,000.5', 'en')).toEqual({ ok: false, error: 'format' });
  });

  it('rejects empty, non-numeric, signed, exponent and non-finite text', () => {
    expect(parseLevelInput('', 'en')).toEqual({ ok: false, error: 'required' });
    expect(parseLevelInput('   ', 'en')).toEqual({ ok: false, error: 'required' });
    const texts = ['abc', '-1', '+3', '1e1', 'Infinity', 'NaN', '.5', '3..8', '3.8.1'];
    expect(texts.map((text) => parseLevelInput(text, 'en'))).toEqual(
      texts.map(() => ({ ok: false, error: 'format' }))
    );
  });

  it('checks precision on the text before any rounding and the bounds after', () => {
    expect(parseLevelInput('7.001', 'en')).toEqual({ ok: false, error: 'precision' });
    expect(parseLevelInput('3.805', 'en')).toEqual({ ok: false, error: 'precision' });
    expect(parseLevelInput('7.01', 'en')).toEqual({ ok: false, error: 'range' });
    expect(parseLevelInput('8', 'en')).toEqual({ ok: false, error: 'range' });
  });

  it('formats an example in the viewer locale', () => {
    expect(exampleLevel('en')).toBe('3.80');
    expect(exampleLevel('pt-BR')).toBe('3,80');
  });
});

describe('validateLevelReviewForm', () => {
  it('builds a canonical exact payload that the server validator accepts', () => {
    const result = validateLevelReviewForm(form({ reason: '  Because  ', evidence: '  ' }), 'en');
    expect(result).toEqual({
      ok: true,
      input: {
        requested_min_level: 3.8,
        requested_max_level: 3.8,
        reason: 'Because',
        evidence: null
      }
    });
    if (!result.ok) throw new Error('expected a valid form');
    expect(() =>
      validateSubmitLevelReview({
        command_id: '11111111-1111-4111-8111-111111111111',
        ...result.input
      })
    ).not.toThrow();
  });

  it('builds a range payload with min <= max and rejects an inverted range', () => {
    expect(
      validateLevelReviewForm(form({ mode: 'range', min: '3,8', max: '4,2' }), 'pt-BR')
    ).toMatchObject({ ok: true, input: { requested_min_level: 3.8, requested_max_level: 4.2 } });
    expect(
      validateLevelReviewForm(form({ mode: 'range', min: '4', max: '4' }), 'en')
    ).toMatchObject({ ok: true, input: { requested_min_level: 4, requested_max_level: 4 } });
    expect(validateLevelReviewForm(form({ mode: 'range', min: '4.2', max: '4' }), 'en')).toEqual({
      ok: false,
      errors: [{ field: 'min', key: 'rangeOrder' }]
    });
  });

  it('reports errors in form order so the first one can take focus', () => {
    const result = validateLevelReviewForm(
      form({ mode: 'range', min: '', max: 'x', reason: ' ', evidence: 'e'.repeat(4001) }),
      'en'
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: 'min', key: 'levelRequired' },
        { field: 'max', key: 'levelFormat' },
        { field: 'reason', key: 'reasonRequired' },
        { field: 'evidence', key: 'evidenceTooLong' }
      ]
    });
  });

  it('ignores the fields of the mode that is not selected', () => {
    expect(
      validateLevelReviewForm(form({ mode: 'exact', min: 'garbage', max: 'garbage' }), 'en').ok
    ).toBe(true);
    expect(
      validateLevelReviewForm(form({ mode: 'range', exact: 'garbage', min: '1', max: '2' }), 'en')
        .ok
    ).toBe(true);
  });

  it('counts code points, so astral characters hit the same bounds as the server', () => {
    expect(validateLevelReviewForm(form({ reason: '🎾'.repeat(2000) }), 'en').ok).toBe(true);
    expect(validateLevelReviewForm(form({ reason: '🎾'.repeat(2001) }), 'en')).toMatchObject({
      ok: false
    });
    expect(validateLevelReviewForm(form({ evidence: '🎾'.repeat(4000) }), 'en').ok).toBe(true);
    expect(validateLevelReviewForm(form({ evidence: '🎾'.repeat(4001) }), 'en').ok).toBe(false);
  });
});

describe('command fingerprint and helpers', () => {
  const input = { requested_min_level: 4, requested_max_level: 4, reason: 'r', evidence: null };
  it('is stable for the same content and changes with any field', () => {
    expect(levelReviewFingerprint(input)).toBe(levelReviewFingerprint({ ...input }));
    for (const change of [
      { requested_min_level: 3.9 },
      { requested_max_level: 4.1 },
      { reason: 'other' },
      { evidence: 'proof' }
    ])
      expect(levelReviewFingerprint({ ...input, ...change })).not.toBe(
        levelReviewFingerprint(input)
      );
  });

  it('knows the active lifecycle states and groups server codes', () => {
    expect(LEVEL_REVIEW_STATUSES.filter(isActiveLevelReview)).toEqual(['pending', 'under_review']);
    expect(levelReviewErrorKind('LEVEL_REVIEW_DUPLICATE_ACTIVE')).toBe('duplicate');
    expect(levelReviewErrorKind('LEVEL_REVIEW_STALE_RATING')).toBe('unavailable');
    expect(levelReviewErrorKind('INVALID_LEVEL_REVIEW_INPUT')).toBe('invalid');
    expect(levelReviewShortId({ id: 'abcdef12-0000-4000-8000-000000000000' })).toBe('ABCDEF12');
  });
});
