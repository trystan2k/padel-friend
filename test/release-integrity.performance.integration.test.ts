import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readHome } from '../src/features/home/home.server';
import { summarize, TARGETS, type Sample } from '../scripts/release-performance.mjs';
import { buildCommunityWorld, type CommunityWorld } from './helpers/community-statistics-world';
import type { ManagementActor } from './helpers/match-management-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { sqlRows } from './helpers/match-registration-sql';
import { playedAt } from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv();
type HomeClient = Parameters<typeof readHome>[0];
type Labelled = Sample & { label: string; cold: boolean };

const CLIENTS = 20;
const READS_PER_CLIENT = 12;
const EVENTS = 55; // submit + approve per event = 110 timed critical writes
const POLL_MS = 3000;

async function timed<T>(run: () => Promise<{ error: unknown } | T>): Promise<Sample> {
  const started = performance.now();
  try {
    const result = await run();
    const failed =
      typeof result === 'object' && result !== null && 'error' in result && !!result.error;
    return { ok: !failed, ms: performance.now() - started };
  } catch {
    return { ok: false, ms: performance.now() - started };
  }
}

/**
 * Opt-in PRD §57 measurement (RELEASE_PERF=1, driven by scripts/release-performance.mjs): 20 clients
 * read Home/unread/rating readers while result submissions and approvals run concurrently, plus a
 * 3s-polling two-client convergence probe under that load. Skipped in every normal run.
 */
describe.skipIf(!environment.env || process.env.RELEASE_PERF !== '1')(
  'release performance (PRD §57)',
  { timeout: 1_800_000 },
  () => {
    let world: CommunityWorld;
    let clients: ManagementActor[];
    beforeAll(async () => {
      world = await buildCommunityWorld(environment.env!);
      const extra = await Promise.all(
        Array.from({ length: CLIENTS - 16 }, () => world.main.actor())
      );
      clients = [...world.players, ...world.otherPlayers, ...extra];
    });
    afterAll(async () => {
      await world?.cleanup();
    });

    it('records read/write latency, amplification and convergence', async () => {
      const calls = { rpc: 0 };
      const rpcSamples = new Map<string, Sample[]>();
      const counted = (actor: ManagementActor) =>
        new Proxy(actor.client, {
          get(target, property) {
            const value = Reflect.get(target, property);
            if (property === 'rpc')
              return (name: string, args?: Record<string, unknown>) => {
                calls.rpc++;
                const label =
                  name === 'list_match_events' ? `${name}:${String(args?.p_entry)}` : name;
                const started = performance.now();
                return Promise.resolve(Reflect.apply(value, target, [name, args])).then(
                  (result: unknown) => {
                    const samples = rpcSamples.get(label) ?? [];
                    samples.push({
                      ms: performance.now() - started,
                      ok: !(
                        result &&
                        typeof result === 'object' &&
                        'error' in result &&
                        result.error
                      )
                    });
                    rpcSamples.set(label, samples);
                    return result;
                  }
                );
              };
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
      const readers = clients.map((actor) => ({ actor, client: counted(actor) }));
      const reads: Labelled[] = [];
      const seen = new Set<string>();
      const measureRead = async (index: number, label: string, run: () => Promise<unknown>) => {
        const key = `${index}:${label}`;
        const cold = !seen.has(key);
        seen.add(key);
        const sample = await timed(async () => {
          const result = await run();
          return result;
        });
        reads.push({ ...sample, label, cold });
      };
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- counted proxy keeps the SupabaseClient surface
      const asHome = (client: unknown) => client as HomeClient;
      const readOnce = (index: number) => {
        const { actor, client } = readers[index]!;
        return [
          () =>
            measureRead(index, 'home', () =>
              readHome(asHome(client), actor.id, { community_id: world.main.communityId })
            ),
          () =>
            measureRead(index, 'unread', async () =>
              actor.client.rpc('count_my_unread_notifications')
            ),
          () => measureRead(index, 'rating', async () => actor.client.rpc('get_my_rating_summary'))
        ];
      };
      const readLoop = async (index: number, stop: () => boolean, max: number) => {
        for (let round = 0; round < max && !stop(); round++)
          for (const read of readOnce(index)) await read();
      };

      // Fixture setup uses trusted multi-command transactions with a different lock shape
      // from live RPC writes. Build events serially before timing; never race fixture SQL
      // against the critical commands being measured.
      const writeEvents: string[] = [];
      const probeEvents: string[] = [];
      for (let index = 0; index < EVENTS + 5; index++) {
        const event = await world.main.event(null, 'friendly');
        (index < EVENTS ? writeEvents : probeEvents).push(event);
      }
      // Phase A: read-only baseline (cold first, then warm).
      const rpcBeforeA = calls.rpc;
      await Promise.all(
        clients.map((_, index) => readLoop(index, () => false, READS_PER_CLIENT / 3))
      );
      const baselineReads = reads.length;
      const rpcPerBaselineRead =
        (calls.rpc - rpcBeforeA) / Math.max(1, reads.filter((r) => r.label === 'home').length);

      // Phase B: concurrent critical writes while all clients keep reading.
      const writes: (Sample & { label: string })[] = [];
      let writesDone = false;
      let convergenceDone = false;
      const writer = async () => {
        const kit = world.main;
        try {
          for (let i = 0; i < EVENTS; i++) {
            const eventId = writeEvents[i]!;
            const played = playedAt(3600).played;
            const submit = await timed(() => kit.submit(eventId, played));
            writes.push({ ...submit, label: 'result.submit' });
            const proposal = await kit.proposalId(eventId);
            const approve = await timed(() => kit.approve(proposal));
            writes.push({ ...approve, label: 'result.review' });
          }
        } finally {
          writesDone = true;
        }
      };
      // Two independently authorized observers poll the specific committed proposal while
      // the same 20-client read load and write stream remain active. This is RPC convergence,
      // not a claim about browser rendering or visibility scheduling.
      const observers = world.players.slice(0, 2);
      const convergence: number[] = [];
      const probe = async () => {
        try {
          for (let trial = 0; trial < 5; trial++) {
            const eventId = probeEvents[trial]!;
            await world.main.submit(eventId, playedAt(3600).played);
            const proposal = await world.main.proposalId(eventId);
            await world.main.approve(proposal);
            const committed = performance.now();
            await Promise.all(
              observers.map(async (observer, index) => {
                // Deterministic stagger covers different poll phases, with no random flakiness.
                await new Promise((resolve) =>
                  setTimeout(resolve, (trial * 617 + index * 1103) % POLL_MS)
                );
                for (;;) {
                  const home = await readHome(asHome(observer.client), observer.id, {
                    community_id: world.main.communityId
                  });
                  const official = await observer.client.rpc('get_match_event_official_results', {
                    p_match_event_id: eventId
                  });
                  if (official.error) throw new Error('Convergence reader failed');
                  const rows = official.data;
                  if (
                    home.unread !== null &&
                    Array.isArray(rows) &&
                    rows.some(
                      (row) =>
                        row &&
                        typeof row === 'object' &&
                        'proposal_id' in row &&
                        row.proposal_id === proposal &&
                        'confirmation_id' in row &&
                        typeof row.confirmation_id === 'string'
                    )
                  )
                    break;
                  if (performance.now() - committed > 20_000)
                    throw new Error('Convergence exceeded 20 seconds');
                  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
                }
                convergence.push(performance.now() - committed);
              })
            );
          }
        } finally {
          convergenceDone = true;
        }
      };
      const outcomes = await Promise.allSettled([
        writer(),
        probe(),
        ...clients.map((_, index) => readLoop(index, () => writesDone && convergenceDone, 1000))
      ]);
      const failure = outcomes.find((outcome) => outcome.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      const loadReads = reads.slice(baselineReads);

      const [dataset] = await sqlRows(
        `select (select count(*)::int from public.match_events) as events,
                 (select count(*)::int from public.notifications) as notifications,
                 (select count(*)::int from public.player_rating_events) as rating_events,
                 (select count(*)::int from public.statistics_group_facts) as groups,
                 (select count(*)::int from public.player_profiles) as players`
      );
      const homeLoad = loadReads.filter((r) => r.label === 'home');
      const report = {
        sourceFingerprint: process.env.RELEASE_PERF_BUILD ?? 'unknown',
        buildArtifact: null,
        at: new Date().toISOString(),
        environment:
          'local Supabase (Docker), single machine; no network distance; shared dev database',
        dataset,
        clients: CLIENTS,
        reads: {
          baseline: summarize(reads.slice(0, baselineReads)),
          underWriteLoad: summarize(loadReads),
          coldOnly: summarize(reads.filter((r) => r.cold)),
          warmOnly: summarize(reads.filter((r) => !r.cold)),
          homeUnderLoad: summarize(homeLoad),
          perLabel: Object.fromEntries(
            ['home', 'unread', 'rating'].map((label) => [
              label,
              summarize(reads.filter((r) => r.label === label))
            ])
          ),
          totalTimed: reads.length
        },
        writes: {
          all: summarize(writes),
          submit: summarize(writes.filter((w) => w.label === 'result.submit')),
          review: summarize(writes.filter((w) => w.label === 'result.review')),
          totalTimed: writes.length
        },
        rpcBreakdown: Object.fromEntries(
          [...rpcSamples.entries()].map(([name, samples]) => [name, summarize(samples)])
        ),
        amplification: {
          rpcPerHomeRead: Number(rpcPerBaselineRead.toFixed(2)),
          pollingIntervalMs: POLL_MS,
          expectedHomeReadsPerSecondAt20Clients: Number(((CLIENTS * 1000) / POLL_MS).toFixed(2)),
          expectedRpcPerSecondAt20Clients: Number(
            ((CLIENTS * 1000 * rpcPerBaselineRead) / POLL_MS).toFixed(1)
          )
        },
        convergenceMs: {
          mode: 'two authenticated RPC observers under concurrent read/write load',
          observers: observers.length,
          trials: convergence.map(Math.round),
          max: Math.round(Math.max(...convergence))
        },
        targets: TARGETS,
        unmeasured: [
          'LCP (needs authenticated browser lane)',
          'local interaction latency (needs authenticated browser lane)'
        ]
      };
      if (process.env.RELEASE_PERF_REPORT)
        writeFileSync(process.env.RELEASE_PERF_REPORT, JSON.stringify(report, null, 2));
      expect(report.reads.totalTimed).toBeGreaterThanOrEqual(200);
      expect(report.writes.totalTimed).toBeGreaterThanOrEqual(100);
    });
  }
);
