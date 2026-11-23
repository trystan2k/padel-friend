export type MatchDatePreset = { date: string; label: string };

const presetCount = 3;
const lookaheadDays = 14;

/**
 * The next weekend days (today included) as local calendar dates of the community timezone,
 * with locale-aware short labels. Presets only prefill the date field; the date input keeps
 * every other day reachable. Unknown timezones yield no presets instead of failing the wizard.
 */
export function matchDatePresets(now: number, timezone: string, locale: string): MatchDatePreset[] {
  try {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now);
    const [year = 0, month = 1, day = 1] = today.split('-').map(Number);
    const label = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC'
    });
    const presets: MatchDatePreset[] = [];
    for (let offset = 0; presets.length < presetCount && offset < lookaheadDays; offset++) {
      const candidate = new Date(Date.UTC(year, month - 1, day + offset));
      const weekday = candidate.getUTCDay();
      if (weekday === 0 || weekday === 6)
        presets.push({
          date: candidate.toISOString().slice(0, 10),
          label: label.format(candidate)
        });
    }
    return presets;
  } catch {
    return [];
  }
}
