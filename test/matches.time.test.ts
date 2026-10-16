import { describe, expect, it } from 'vitest';
import {
  localMatchInstant,
  validateLocalDate,
  validateLocalTime
} from '../src/features/matches/match-time';

describe('match local time', () => {
  it('rejects impossible dates and times', () => {
    expect(() => validateLocalDate('2026-02-30')).toThrow('INVALID_MATCH_DATE');
    expect(() => validateLocalTime('25:00')).toThrow('INVALID_MATCH_TIME');
  });
  it('uses earlier occurrence for repeated DST times and rejects gaps', () => {
    const repeated = localMatchInstant('2026-10-25', '02:30', 'Europe/Madrid');
    expect(repeated.instant.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(repeated.offset).toBe('+02:00');
    expect(() => localMatchInstant('2026-03-29', '02:30', 'Europe/Madrid')).toThrow(
      'INVALID_MATCH_LOCAL_TIME'
    );
  });
});
