import { describe, expect, it } from 'vitest';
import { parseHomeSearch, validateHomeInput } from '../src/features/home/home.validators';

const ID = '3f2a1c4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b';

describe('home validators', () => {
  it('keeps a well-formed community id and lowercases it', () => {
    expect(parseHomeSearch({ community: ID.toUpperCase() })).toEqual({ community: ID });
  });

  it.each([{ community: 'nope' }, { community: 3 }, { community: ['x'] }, {}])(
    'drops a malformed or absent community search %#',
    (search) => {
      expect(parseHomeSearch(search)).toEqual({});
    }
  );

  it('keeps unrelated search keys so preserved deep links survive', () => {
    expect(parseHomeSearch({ src: 'e2e', community: 'nope' })).toEqual({ src: 'e2e' });
    expect(parseHomeSearch({ src: 'e2e', community: ID })).toEqual({ src: 'e2e', community: ID });
  });

  it('accepts a null or valid community and rejects everything else', () => {
    expect(validateHomeInput({ community_id: null })).toEqual({ community_id: null });
    expect(validateHomeInput({})).toEqual({ community_id: null });
    expect(validateHomeInput({ community_id: ID })).toEqual({ community_id: ID });
    expect(() => validateHomeInput({ community_id: 'x' })).toThrow('INVALID_HOME_INPUT');
    expect(() => validateHomeInput({ community_id: ID, extra: 1 })).toThrow('INVALID_HOME_INPUT');
    expect(() => validateHomeInput(null)).toThrow('INVALID_HOME_INPUT');
    expect(() => validateHomeInput([])).toThrow('INVALID_HOME_INPUT');
  });
});
