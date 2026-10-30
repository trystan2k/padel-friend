import { describe, expect, it, vi } from 'vitest';
import { advanceTrustedResultSchedulerClock } from './match-result-processing-fixtures';
import { fixtureSql } from './match-registration-sql';

vi.mock('./match-registration-sql', () => ({
  fixtureSql: vi.fn<(sql: string) => Promise<void>>().mockResolvedValue(undefined)
}));

describe('trusted result scheduler clock', () => {
  it('advances the single fixture clock by the requested interval', async () => {
    await advanceTrustedResultSchedulerClock(60);
    expect(fixtureSql).toHaveBeenCalledWith(expect.stringContaining('make_interval(secs => 60)'));
  });

  it('rejects invalid intervals without executing SQL', async () => {
    vi.mocked(fixtureSql).mockClear();
    await expect(advanceTrustedResultSchedulerClock(0)).rejects.toThrow('between 1 and 3600');
    expect(fixtureSql).not.toHaveBeenCalled();
  });
});
