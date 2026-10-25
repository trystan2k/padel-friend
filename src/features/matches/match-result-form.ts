import type { ManagementParticipant } from './match-management-model';
import type { MatchRosterEntry } from './match-registration-model';
import { localMatchInstant } from './match-time';

/** Group membership comes from the safe roster, identities from the authorized projection. */
export function resultGroupPlayers(
  roster: MatchRosterEntry[],
  participants: ManagementParticipant[],
  group: number
) {
  return roster
    .filter((row) => row.participation === 'playing' && row.group_number === group)
    .sort((a, b) => a.accepted_order - b.accepted_order)
    .flatMap((row) => {
      const player = participants.find(
        (entry) => entry.accepted_order === row.accepted_order && entry.participation === 'playing'
      );
      return player ? [player] : [];
    });
}

/** Enumerate real offsets only; nonexistent times have none, DST folds have two. */
export function resultPlayedOffsets(date: string, time: string, timezone: string): number[] {
  try {
    const first = localMatchInstant(date, time, timezone);
    const guess = Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    const candidates = new Set<number>([(guess - first.instant.getTime()) / 1000]);
    for (const hours of [-36, 36]) {
      const instant = first.instant.getTime() + hours * 3600000;
      const parts = Object.fromEntries(
        formatter.formatToParts(instant).map(({ type, value }) => [type, value])
      );
      candidates.add(
        (Date.parse(
          `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`
        ) -
          instant) /
          1000
      );
    }
    return [...candidates]
      .filter((offset) => {
        try {
          localMatchInstant(date, time, timezone, offset);
          return true;
        } catch {
          return false;
        }
      })
      .sort((a, b) => b - a);
  } catch {
    return [];
  }
}

export function resultOffsetLabel(seconds: number) {
  const minutes = Math.abs(seconds / 60);
  return `${seconds < 0 ? '-' : '+'}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
