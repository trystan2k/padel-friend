import { describe, expect, it, vi } from 'vitest';
import {
  LEAGUE_ID,
  makeFinalStandings,
  makeFormerParticipantDetail,
  makeLeagueDetail,
  makeLiveStandings
} from './helpers/league-dto-fixtures';

const mocks = vi.hoisted(() => ({
  getLeague: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  standings: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  versions: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  audit: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  viewer: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('../src/features/leagues/league.functions', () => ({
  getLeague: mocks.getLeague,
  getLeagueStandings: mocks.standings,
  listLeagueStandingsVersions: mocks.versions,
  getLeagueStandingsAudit: mocks.audit,
  getLeagueViewer: mocks.viewer
}));
import { Route } from '../src/routes/_protected.community.$communityId.leagues.$leagueId';

type Loader = (context: {
  params: { communityId: string; leagueId: string };
  deps: { version?: number };
}) => Promise<{ detail: { access_mode: string }; audit: unknown; auditFailed: boolean }>;
function hasLoader(route: unknown): route is { options: { loader: Loader } } {
  const options =
    typeof route === 'object' && route !== null ? Reflect.get(route, 'options') : null;
  return (
    typeof options === 'object' &&
    options !== null &&
    typeof Reflect.get(options, 'loader') === 'function'
  );
}
function loader(): Loader {
  if (!hasLoader(Route)) throw new Error('Missing League detail loader');
  return Route.options.loader;
}
const context = { params: { communityId: 'c', leagueId: LEAGUE_ID }, deps: {} };

describe('League detail route loader', () => {
  const closed = { status: 'closed' as const };

  function arrange(detail: unknown) {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getLeague.mockResolvedValue(detail);
    mocks.standings.mockResolvedValue(makeFinalStandings([]));
    mocks.versions.mockResolvedValue({ versions: [] });
    mocks.audit.mockResolvedValue({ events: [] });
    mocks.viewer.mockResolvedValue({ user_id: 'u' });
  }

  it('loads detail, standings and versions for a former participant without requesting the audit', async () => {
    arrange(makeFormerParticipantDetail(closed));
    const loaded = await loader()(context);
    expect(loaded.detail.access_mode).toBe('former_participant');
    expect(mocks.standings).toHaveBeenCalledOnce();
    expect(mocks.versions).toHaveBeenCalledOnce();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(loaded.audit).toBeNull();
    expect(loaded.auditFailed).toBe(false);
  });

  it('still requests the audit for a managing member of a closed League', async () => {
    arrange(makeLeagueDetail({ ...closed, can_manage: true }));
    await loader()(context);
    expect(mocks.audit).toHaveBeenCalledOnce();
  });

  it('keeps the detail usable when the standings reader fails, and honors the selected version', async () => {
    arrange(makeFormerParticipantDetail(closed));
    mocks.standings.mockRejectedValue(new Error('offline'));
    const loaded = await loader()({ ...context, deps: { version: 2 } });
    expect(loaded.detail.access_mode).toBe('former_participant');
    expect(mocks.standings).toHaveBeenCalledWith({
      data: { league_id: LEAGUE_ID, standings_version: 2 }
    });
  });

  it('never trusts a URL search flag as access: only the server detail decides', async () => {
    arrange(makeFormerParticipantDetail({ status: 'active' }));
    mocks.standings.mockResolvedValue(makeLiveStandings([]));
    const search = Route.options.validateSearch;
    expect(
      typeof search === 'function' ? search({ access_mode: 'member', version: 'x' }) : null
    ).toEqual({});
    expect((await loader()(context)).detail.access_mode).toBe('former_participant');
  });
});
