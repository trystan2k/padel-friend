import type { ResultProposal } from './match-result-model';

/** Display gate only; amendment commands independently authorize against persisted facts. */
export function canRequestResultCorrection(
  proposal: Pick<ResultProposal, 'teams'>,
  creatorId: string,
  callerId: string | null,
  isAdmin: boolean
): boolean {
  if (!callerId) return false;
  return (
    isAdmin ||
    callerId === creatorId ||
    [...proposal.teams.team_a, ...proposal.teams.team_b].some(
      (player) => player.user_id === callerId
    )
  );
}
