import { createFileRoute } from '@tanstack/react-router';
import { LeagueDetailPage } from '../features/leagues/LeagueDetailPage';
import { LeagueLoading, LeagueRouteError } from '../features/leagues/LeagueRouteStates';
import { leagueErrorCode } from '../features/leagues/league-errors';
import {
  getLeague,
  getLeagueStandings,
  getLeagueStandingsAudit,
  getLeagueViewer,
  listLeagueStandingsVersions
} from '../features/leagues/league.functions';

export const Route = createFileRoute('/_protected/community/$communityId/leagues/$leagueId')({
  /** `version` selects one published final of a closed League; anything else means the latest. */
  validateSearch: (search: Record<string, unknown>): { version?: number } => {
    const version = Number(search.version);
    return Number.isSafeInteger(version) && version >= 1 ? { version } : {};
  },
  loaderDeps: ({ search }) => ({ version: search.version }),
  loader: async ({ params, deps }) => {
    const detail = await getLeague({ data: { league_id: params.leagueId } });
    const { league } = detail;
    // Standings, history and audit are supplementary: an unavailable reader must not hide the
    // League itself; the page shows a translated unavailable state with a retry instead.
    const standings = await getLeagueStandings({
      data: { league_id: params.leagueId, standings_version: deps.version ?? null }
    }).then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error: leagueErrorCode(error) })
    );
    const closed = league.status === 'closed';
    const [versions, audit, viewer] = await Promise.all([
      closed
        ? listLeagueStandingsVersions({
            data: { league_id: params.leagueId, before_version: null }
          }).catch(() => null)
        : null,
      // Only owner/Admin viewers request the audit, so a failure here is an error to retry, never
      // "not allowed": non-managers never reach this branch and show no audit section at all.
      closed && league.can_manage
        ? getLeagueStandingsAudit({ data: { league_id: params.leagueId } }).then(
            (value) => ({ value, failed: false }),
            () => ({ value: null, failed: true })
          )
        : { value: null, failed: false },
      getLeagueViewer().catch(() => null)
    ]);
    return {
      detail,
      standings: standings.value,
      standingsError: standings.error,
      versions,
      audit: audit.value,
      auditFailed: audit.failed,
      viewerId: viewer?.user_id ?? null
    };
  },
  pendingComponent: LeagueLoading,
  errorComponent: LeagueRouteError,
  component: () => {
    const { detail, standings, standingsError, versions, audit, auditFailed, viewerId } =
      Route.useLoaderData();
    return (
      <LeagueDetailPage
        data={detail}
        standings={standings}
        standingsError={standingsError}
        versions={versions}
        audit={audit}
        auditFailed={auditFailed}
        viewerId={viewerId}
      />
    );
  }
});
