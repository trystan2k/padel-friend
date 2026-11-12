import { GUARD_TRIGGERS } from '../../scripts/isolation-proof-product-fixtures.mjs';

type Row = Record<string, unknown>;
export function productWorld() {
  const state = {
    communities: [] as Row[],
    events: [] as Row[],
    proposals: [] as Row[],
    versions: [] as Row[],
    photos: new Map<string, string>(),
    guards: new Map(GUARD_TRIGGERS.map(([table, trigger]) => [table + '.' + trigger, 'O'])),
    log: [] as Array<{ sql: string; params: unknown[] }>,
    failSql: '',
    residue: '',
    dueCount: undefined as number | undefined,
    missingGuard: false,
    tamperAfterCommit: false
  };
  let backup:
    | Pick<typeof state, 'communities' | 'events' | 'proposals' | 'versions' | 'guards'>
    | undefined;
  let aborted = false;
  const tableRows = (table: string) => {
    if (table === 'communities') return state.communities;
    if (table === 'match_events') return state.events;
    if (table === 'match_event_result_proposals') return state.proposals;
    if (table === 'match_event_result_proposal_versions') return state.versions;
    return [];
  };
  const query = (sql: string, params: unknown[] = []): { rows: Row[] } | undefined => {
    state.log.push({ sql, params });
    if (sql === 'rollback') {
      if (backup) Object.assign(state, backup);
      backup = undefined;
      aborted = false;
      return undefined;
    }
    if (aborted) throw new Error('transaction aborted');
    if (state.failSql && sql.includes(state.failSql)) {
      aborted = Boolean(backup);
      throw new Error('injected product SQL failure');
    }
    if (sql === 'begin') {
      backup = structuredClone({
        communities: state.communities,
        events: state.events,
        proposals: state.proposals,
        versions: state.versions,
        guards: state.guards
      });
      return undefined;
    }
    if (sql === 'commit') {
      backup = undefined;
      if (state.tamperAfterCommit) state.guards.set(GUARD_TRIGGERS[0]!.join('.'), 'D');
      return undefined;
    }
    if (sql.includes('pg_catalog.pg_trigger')) {
      const rows = [...state.guards]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, enabled]) => {
          const [table_name, trigger_name] = key.split('.');
          return { table_name, trigger_name, enabled };
        });
      return { rows: state.missingGuard ? rows.slice(1) : rows };
    }
    if (sql.startsWith('alter table')) {
      const match =
        /alter table public.(\w+) (disable|enable(?: always| replica)?) trigger (\w+)/.exec(sql);
      if (!match) throw new Error('unexpected trigger statement');
      state.guards.set(
        match[1] + '.' + match[3],
        match[2] === 'disable' ? 'D' : match[2] === 'enable always' ? 'A' : 'O'
      );
      return { rows: [] };
    }
    if (sql.startsWith('insert into public.communities')) {
      state.communities.push({ id: params[0], name: params[1], created_by: params[2] });
      return { rows: [] };
    }
    if (sql.startsWith('insert into public.match_events')) {
      const [id, community_id, created_by, venue_name, photo_path] = params;
      if (!state.photos.has(String(photo_path))) throw new Error('photo not uploaded');
      state.events.push({ id, community_id, created_by, venue_name, photo_path });
      return { rows: [] };
    }
    if (sql.startsWith('insert into public.match_event_result_proposals ')) {
      state.proposals.push({ id: params[0], match_event_id: params[1], submitted_by: params[2] });
      return { rows: [] };
    }
    if (sql.startsWith('insert into public.match_event_result_proposal_versions ')) {
      state.versions.push({ proposal_id: params[0], version: 1 });
      return { rows: [] };
    }
    if (
      sql.startsWith('update storage.objects') ||
      sql.startsWith('update public.match_event_registrations')
    )
      return { rows: [] };
    if (sql.startsWith('select (select count(*) from public.communities'))
      return {
        rows: [
          {
            communities: state.communities.filter(
              (row) => row.id === params[0] || row.name === params[1]
            ).length,
            events: state.events.filter(
              (row) =>
                row.community_id === params[0] ||
                (Array.isArray(params[4]) && params[4].includes(row.id))
            ).length,
            photos: [...state.photos.keys()].filter((name) => name.startsWith(String(params[3])))
              .length,
            proposals: state.proposals.filter(
              (row) => Array.isArray(params[5]) && params[5].includes(row.id)
            ).length,
            versions: state.versions.filter(
              (row) => Array.isArray(params[5]) && params[5].includes(row.proposal_id)
            ).length
          }
        ]
      };
    if (sql.includes('from public.match_event_registration_state s join'))
      return {
        rows: [
          {
            n: state.dueCount ?? state.events.filter((row) => row.community_id === params[0]).length
          }
        ]
      };
    if (
      sql.startsWith('select ') &&
      sql.includes('from public.communities where id') &&
      !sql.startsWith('select count')
    )
      return { rows: state.communities.filter((row) => row.id === params[0]) };
    if (sql.includes('from public.match_events where community_id'))
      return {
        rows: state.events
          .filter((row) => row.community_id === params[0])
          .map(({ id, created_by, photo_path }) => ({ id, created_by, photo_path }))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      };
    if (
      sql.startsWith('select proposal_id') &&
      sql.includes('from public.match_event_result_proposal_versions where proposal_id')
    )
      return {
        rows: state.versions.filter(
          (row) => Array.isArray(params[0]) && params[0].includes(row.proposal_id)
        )
      };
    if (sql.includes('from public.match_event_result_proposals p join')) {
      const events = new Set(
        state.events.filter((row) => row.community_id === params[0]).map((row) => row.id)
      );
      return {
        rows: state.proposals
          .filter((row) => events.has(row.match_event_id))
          .map(({ id, match_event_id }) => ({ id, match_event_id }))
      };
    }
    if (sql.includes('from public.match_event_result_proposals where match_event_id'))
      return {
        rows: state.proposals.filter(
          (row) => Array.isArray(params[0]) && params[0].includes(row.match_event_id)
        )
      };
    if (sql.startsWith('select name from storage.objects'))
      return {
        rows: [...state.photos.keys()]
          .filter((name) => name.startsWith(String(params[1])))
          .sort()
          .map((name) => ({ name }))
      };
    const deleted = /^delete from public.(\w+) where (\w+) = any/.exec(sql);
    if (deleted) {
      const rows = tableRows(deleted[1]!);
      for (let i = rows.length - 1; i >= 0; i -= 1)
        if (Array.isArray(params[0]) && params[0].includes(rows[i]![deleted[2]!]))
          rows.splice(i, 1);
      return { rows: [] };
    }
    const count = /^select count\(\*\)::int as n from public.(\w+) where (\w+) = any/.exec(sql);
    if (count)
      return {
        rows: [
          {
            n:
              state.residue === count[1]
                ? 1
                : tableRows(count[1]!).filter(
                    (row) => Array.isArray(params[0]) && params[0].includes(row[count[2]!])
                  ).length
          }
        ]
      };
    if (sql.startsWith('lock table') || sql.startsWith('set ')) return { rows: [] };
    return undefined;
  };
  return { state, query };
}
