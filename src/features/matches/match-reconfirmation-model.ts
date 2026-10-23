import {
  parseManagementSuccess,
  type ManagementResult,
  type ManagementSuccess
} from './match-management-model';
import type { MatchRegistrationParticipation } from './match-registration-model';

export type ReconfirmationSuccess = ManagementSuccess & {
  confirmed_generation: number;
  participation: MatchRegistrationParticipation;
};
export function parseReconfirmationSuccess(
  value: unknown
): ManagementResult<ReconfirmationSuccess> | null {
  const parsed = parseManagementSuccess(value);
  if (parsed?.status !== 'ok' || typeof value !== 'object' || value === null) return null;
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (
    typeof row.confirmed_generation !== 'number' ||
    !Number.isSafeInteger(row.confirmed_generation) ||
    row.confirmed_generation < 1 ||
    (row.participation !== 'playing' &&
      row.participation !== 'reserve' &&
      row.participation !== 'reserve_not_playing')
  )
    return null;
  return {
    ...parsed,
    value: {
      ...parsed.value,
      confirmed_generation: row.confirmed_generation,
      participation: row.participation
    }
  };
}
export function requiresMatchReconfirmation(player: {
  required_generation?: number;
  confirmed_generation?: number;
}) {
  return (
    typeof player.required_generation === 'number' &&
    typeof player.confirmed_generation === 'number' &&
    player.confirmed_generation < player.required_generation
  );
}
