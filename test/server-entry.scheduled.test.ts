import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  fetch: vi.fn<() => Promise<Response>>(),
  sweep: vi.fn<() => Promise<void>>(),
  push: vi.fn<() => Promise<void>>(),
  diagnostics: vi.fn<() => Promise<unknown>>(),
  alerts: vi.fn<() => Promise<unknown>>()
}));
vi.mock('@tanstack/react-start/server-entry', () => ({ default: { fetch: mocks.fetch } }));
vi.mock('../src/features/matches/match-add-player.server', () => ({
  sweepMatchPlayerAddsOnSchedule: mocks.sweep
}));
vi.mock('../src/features/notifications/push-dispatch.server', () => ({
  sweepNotificationPushOnSchedule: mocks.push
}));
vi.mock('../src/features/notifications/operational-alerts.server', () => ({
  sweepOperationalAlertsOnSchedule: mocks.alerts
}));
vi.mock('../src/features/result-repairs/job-diagnostics.server', () => ({
  sweepJobDiagnosticsOnSchedule: mocks.diagnostics
}));
import { requestReference } from '../src/lib/diagnostics.server';
import worker from '../src/server';

describe('Worker entry', () => {
  beforeEach(() => {
    mocks.sweep.mockReset().mockResolvedValue(undefined);
    mocks.push.mockReset().mockResolvedValue(undefined);
    mocks.diagnostics.mockReset().mockResolvedValue(undefined);
    mocks.alerts.mockReset().mockResolvedValue(undefined);
  });
  it('delegates fetch to the TanStack Start handler', async () => {
    mocks.fetch.mockResolvedValue(new Response('ok'));
    const response = await worker.fetch(new Request('http://localhost/assets/app.js'));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe('ok');
  });
  it('forces private/no-store on SSR documents without touching public assets', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
    );
    const page = await worker.fetch(new Request('http://localhost/dashboard'));
    expect(page.headers.get('cache-control')).toBe('private, no-store');
    const asset = new Response('js', { headers: { 'cache-control': 'public, immutable' } });
    mocks.fetch.mockResolvedValueOnce(asset);
    expect(await worker.fetch(new Request('http://localhost/assets/a.js'))).toBe(asset);
  });
  it('runs independent server-only sweeps inside waitUntil', async () => {
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    worker.scheduled({}, {}, { waitUntil });
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
    expect(mocks.sweep).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.diagnostics).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.alerts).toHaveBeenCalledExactlyOnceWith();
  });
  it.each(['sweep', 'push'] as const)(
    'surfaces %s failure without starving other sweep',
    async (name) => {
      mocks[name].mockRejectedValue(new Error('sensitive provider error'));
      const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
      worker.scheduled({}, {}, { waitUntil });
      await expect(waitUntil.mock.calls[0]?.[0]).rejects.toThrow('SCHEDULED_SWEEP_FAILED');
      expect(mocks.sweep).toHaveBeenCalledTimes(1);
      expect(mocks.push).toHaveBeenCalledTimes(1);
    }
  );

  it('returns a safe correlated private error when the framework throws', async () => {
    const sink = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.fetch.mockRejectedValueOnce(new Error('private SQL and token'));
    const response = await worker.fetch(new Request('http://localhost/dashboard'));
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await response.text()).toBe('');
    expect(JSON.parse(String(sink.mock.calls[0]?.[0]))).toMatchObject({
      event: 'request.failure',
      code: 'INTERNAL',
      requestId: response.headers.get('x-request-id')
    });
    sink.mockRestore();
  });
  it('stamps a freshly minted X-Request-Id and never echoes a client-supplied one', async () => {
    mocks.fetch.mockImplementation(async () => new Response('ok'));
    const first = await worker.fetch(
      new Request('http://localhost/assets/a.js', {
        headers: { 'x-request-id': 'attacker-forged' }
      })
    );
    const second = await worker.fetch(new Request('http://localhost/assets/a.js'));
    const [one, two] = [first.headers.get('x-request-id'), second.headers.get('x-request-id')];
    expect(one).toMatch(/^[0-9a-f-]{36}$/);
    expect(two).toMatch(/^[0-9a-f-]{36}$/);
    expect(one).not.toBe(two);
  });
  it('keeps every Set-Cookie and the body stream, and copes with immutable headers', async () => {
    const headers = new Headers({ 'content-type': 'text/html' });
    headers.append('set-cookie', 'sb-a=1; Path=/');
    headers.append('set-cookie', 'sb-b=2; Path=/');
    mocks.fetch.mockResolvedValueOnce(new Response('streamed', { headers }));
    const page = await worker.fetch(new Request('http://localhost/auth/callback'));
    expect(page.headers.getSetCookie()).toEqual(['sb-a=1; Path=/', 'sb-b=2; Path=/']);
    expect(page.headers.get('x-request-id')).toBeTruthy();
    expect(await page.text()).toBe('streamed');
    mocks.fetch.mockResolvedValueOnce(Response.redirect('http://localhost/login', 302));
    const out = await worker.fetch(new Request('http://localhost/dashboard'));
    expect(out.status).toBe(302);
    expect(out.headers.get('x-request-id')).toBeTruthy();
  });
  it('gives each concurrent request its own correlation ID inside the handler', async () => {
    const seen: (string | null)[] = [];
    mocks.fetch.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
      seen.push(requestReference());
      return new Response('ok');
    });
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => worker.fetch(new Request('http://localhost/assets/a.js')))
    );
    expect(new Set(seen).size).toBe(6);
    expect(new Set(responses.map((response) => response.headers.get('x-request-id')))).toEqual(
      new Set(seen)
    );
  });
  it('runs the alert sweep independently and logs job-scoped sweep events without leaking errors', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.sweep.mockRejectedValue(new Error('sensitive provider error'));
    mocks.push.mockRejectedValue(new Error('sensitive provider error'));
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    worker.scheduled({}, {}, { waitUntil });
    await expect(waitUntil.mock.calls[0]?.[0]).rejects.toThrow('SCHEDULED_SWEEP_FAILED');
    expect(mocks.alerts).toHaveBeenCalledTimes(1);
    const events = [...info.mock.calls, ...error.mock.calls].map(([line]) => {
      const parsed: unknown = JSON.parse(String(line));
      if (!parsed || typeof parsed !== 'object') throw new Error('log line is not an object');
      return Object.fromEntries(Object.entries(parsed));
    });
    const sweeps = events.filter((event) => event['event'] === 'scheduled.sweep');
    expect(
      sweeps
        .map((event) => `${event['job']}:${event['outcome']}`)
        .sort((a, b) => a.localeCompare(b))
    ).toEqual(['alerts:success', 'diagnostics:success', 'player-adds:failure', 'push:failure']);
    expect(new Set(sweeps.map((event) => event['jobId'])).size).toBe(1);
    expect(JSON.stringify(events)).not.toContain('sensitive');
  });
  it('fails the run when only the alert sweep fails, without starving the others', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    mocks.alerts.mockRejectedValue(new Error('ALERT_SIGNALS_UNAVAILABLE'));
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    worker.scheduled({}, {}, { waitUntil });
    await expect(waitUntil.mock.calls[0]?.[0]).rejects.toThrow('SCHEDULED_SWEEP_FAILED');
    expect(mocks.sweep).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
});
