import { describe, expect, it } from 'vitest';
import { matchDatePresets } from '../src/features/matches/match-date-presets';

describe('matchDatePresets', () => {
  it('returns the next three weekend days as local dates of the community timezone', () => {
    // Wednesday 15 May 2030, midday in Madrid.
    const presets = matchDatePresets(Date.UTC(2030, 4, 15, 10), 'Europe/Madrid', 'en');
    expect(presets.map((preset) => preset.date)).toEqual([
      '2030-05-18',
      '2030-05-19',
      '2030-05-25'
    ]);
    expect(presets[0]?.label).toBe('Sat, May 18');
  });

  it('includes today when the community-local day is already a weekend day', () => {
    // 17 May 2030 23:30 UTC is already Saturday 18 May in Tokyo, still Friday in Madrid.
    const now = Date.UTC(2030, 4, 17, 23, 30);
    expect(matchDatePresets(now, 'Asia/Tokyo', 'en')[0]?.date).toBe('2030-05-18');
    expect(matchDatePresets(now, 'Europe/Madrid', 'en')[0]?.date).toBe('2030-05-18');
    expect(matchDatePresets(now, 'America/Los_Angeles', 'en').map((p) => p.date)).toEqual([
      '2030-05-18',
      '2030-05-19',
      '2030-05-25'
    ]);
  });

  it('localizes labels and survives an unknown timezone with no presets', () => {
    const now = Date.UTC(2030, 4, 15, 10);
    expect(matchDatePresets(now, 'Europe/Madrid', 'pt-BR')[0]?.label).toMatch(/sáb/i);
    expect(matchDatePresets(now, 'Not/AZone', 'en')).toEqual([]);
  });
});
