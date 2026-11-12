import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  IsolationProofError,
  assertPreviewPortAvailable,
  defaultLiveProbe,
  previewListenerOwned
} from '../scripts/verify-test-stack-isolation.mjs';

type Handler = (request: { url: () => string }) => void;

function browserFake(requestUrls: string[], loginOk = true) {
  const closed = vi.fn<() => Promise<void>>(async () => undefined);
  const page = {
    handler: undefined as Handler | undefined,
    on(_event: string, handler: Handler) {
      page.handler = handler;
    },
    goto: vi.fn<(url: string) => Promise<void>>(async () => {
      for (const url of requestUrls) page.handler?.({ url: () => url });
    }),
    fill: vi.fn<(selector: string, value: string) => Promise<void>>(async () => undefined),
    click: vi.fn<(selector: string) => Promise<void>>(async () => undefined),
    waitForResponse: vi.fn<() => Promise<{ ok: () => boolean }>>(async () => ({
      ok: () => loginOk
    }))
  };
  const chromium = {
    launch: vi.fn<(options: object) => Promise<unknown>>(async () => ({
      newContext: async () => ({ newPage: async () => page }),
      close: closed
    }))
  };
  return { page, chromium, closed };
}

function probeDeps(
  options: { callback?: Response; requestUrls?: string[]; loginOk?: boolean } = {}
) {
  const browser = browserFake(
    options.requestUrls ?? [
      'http://127.0.0.1:55421/auth/v1/token?grant_type=password',
      'http://127.0.0.1:55421/rest/v1/profiles',
      'http://127.0.0.1:4183/assets/app.js'
    ],
    options.loginOk
  );
  let started = false;
  const preview = Object.assign(new EventEmitter(), {
    pid: undefined as number | undefined,
    kill: vi.fn<(signal: string) => void>(() => {
      queueMicrotask(() => {
        preview.emit('exit', 0, 'SIGTERM');
        preview.emit('close', 0, 'SIGTERM');
      });
    })
  });
  const spawnImpl = vi.fn<(...args: unknown[]) => typeof preview>(() => {
    started = true;
    return preview;
  });
  const callbackHeaders = new Headers({ location: 'http://127.0.0.1:4183/dashboard' });
  callbackHeaders.append('set-cookie', 'sb-127-auth-token=abc; Path=/');
  const fetchImpl = vi.fn<typeof fetch>(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/auth/callback'))
      return options.callback ?? new Response(null, { status: 303, headers: callbackHeaders });
    if (!started) throw new Error('connection refused');
    return new Response('ok');
  });
  return { browser, preview, spawnImpl, fetchImpl };
}

const login = { email: 'proof@isolation-proof.local', password: 'fake-proof-password' };

describe('default live browser and SSR probe', () => {
  it.each([
    ['child', '123', '', true],
    ['descendant', '456', '123', true],
    ['foreign', '456', '1', false],
    ['mixed listeners', '123\n456', '1', false],
    ['no listeners', '', '', false],
    ['parent cycle', '456', '456', false]
  ] as const)('verifies socket ownership: %s', (_label, listeners, parent, owned) => {
    const exec = vi.fn<(command: string) => string>((command) =>
      command === 'lsof' ? listeners : parent
    );
    expect(previewListenerOwned(4183, 123, exec)).toBe(owned);
  });

  it('fails closed when process inspection is unavailable', () => {
    expect(
      previewListenerOwned(4183, 123, () => {
        throw new Error('missing lsof');
      })
    ).toBe(false);
    expect(previewListenerOwned(4183, undefined)).toBe(false);
  });
  it('records browser request hosts and the SSR token verdict, and stops the preview it started', async () => {
    const deps = probeDeps();
    const result = await defaultLiveProbe({
      login,
      inviteHash: 'fake-hash',
      fetchImpl: deps.fetchImpl,
      spawnImpl: deps.spawnImpl,
      checkPort: async () => undefined,
      checkOwner: async () => true,
      loadPlaywright: async () => ({ chromium: deps.browser.chromium })
    });

    expect(result).toEqual({
      // Only Auth/PostgREST traffic is recorded; the preview's own asset origin is not evidence.
      browser: { requestHosts: ['127.0.0.1:55421'], loginSucceeded: true },
      ssr: { tokenAccepted: true, sessionCookieSet: true }
    });
    expect(deps.browser.page.fill).toHaveBeenCalledWith('input[name="email"]', login.email);
    expect(deps.browser.closed).toHaveBeenCalledOnce();
    expect(deps.preview.kill).toHaveBeenCalledWith('SIGTERM');
    expect(JSON.stringify(result)).not.toContain(login.password);
    expect(JSON.stringify(result)).not.toContain('fake-hash');
  });

  it('refuses a foreign listener that binds after the availability check', async () => {
    const deps = probeDeps();
    const checkOwner = vi.fn<() => Promise<boolean>>(async () => false);
    await expect(
      defaultLiveProbe({
        login,
        inviteHash: 'fake-hash',
        fetchImpl: deps.fetchImpl,
        spawnImpl: deps.spawnImpl,
        checkPort: async () => undefined,
        checkOwner,
        loadPlaywright: async () => ({ chromium: deps.browser.chromium })
      })
    ).rejects.toThrow('preview listener ownership mismatch');
    expect(checkOwner).toHaveBeenCalled();
    expect(deps.browser.chromium.launch).not.toHaveBeenCalled();
    expect(deps.preview.kill).toHaveBeenCalled();
  });

  it.each(['login', 'callback'])(
    'fails immediately on child exit during %s and cleans up',
    async (phase) => {
      const deps = probeDeps();
      const hangUntilExit = () => {
        deps.preview.emit('exit', 1, null);
        return new Promise<never>(() => undefined);
      };
      if (phase === 'login') deps.browser.page.goto.mockImplementation(hangUntilExit);
      else {
        const original = deps.fetchImpl.getMockImplementation()!;
        deps.fetchImpl.mockImplementation((input, init) =>
          (input instanceof Request ? input.url : String(input)).includes('/auth/callback')
            ? hangUntilExit()
            : original(input, init)
        );
      }
      await expect(
        defaultLiveProbe({
          login,
          inviteHash: 'fake-hash',
          fetchImpl: deps.fetchImpl,
          spawnImpl: deps.spawnImpl,
          checkPort: async () => undefined,
          checkOwner: async () => true,
          loadPlaywright: async () => ({ chromium: deps.browser.chromium })
        })
      ).rejects.toThrow('preview exited during probe');
      expect(deps.browser.closed).toHaveBeenCalledOnce();
      expect(deps.preview.kill).toHaveBeenCalledWith('SIGTERM');
    },
    1000
  );

  it('fails before stalled browser launch settles and disposes its late browser', async () => {
    const deps = probeDeps();
    const lateBrowser = await deps.browser.chromium.launch({});
    deps.browser.closed.mockClear();
    let resolveLaunch!: (browser: unknown) => void;
    deps.browser.chromium.launch.mockImplementation(() => {
      deps.preview.emit('exit', 1, null);
      return new Promise((resolve) => {
        resolveLaunch = resolve;
      });
    });
    const result = defaultLiveProbe({
      login,
      inviteHash: 'fake-hash',
      fetchImpl: deps.fetchImpl,
      spawnImpl: deps.spawnImpl,
      checkPort: async () => undefined,
      checkOwner: async () => true,
      loadPlaywright: async () => ({ chromium: deps.browser.chromium })
    }).catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(deps.preview.kill).toHaveBeenCalledWith('SIGTERM'), {
        timeout: 200
      });
      expect(await result).toEqual(new IsolationProofError('preview exited during probe'));
      expect(deps.browser.closed).not.toHaveBeenCalled();
    } finally {
      resolveLaunch(lateBrowser);
      await result;
    }
    await vi.waitFor(() => expect(deps.browser.closed).toHaveBeenCalledOnce());
    expect(deps.browser.page.goto).not.toHaveBeenCalled();
  });

  it('replaces failing password-fill call logs with a fixed reason', async () => {
    const deps = probeDeps();
    deps.browser.page.fill.mockImplementation(async (selector, value) => {
      if (selector.includes('password')) throw new Error('fill argument: ' + value);
    });
    await expect(
      defaultLiveProbe({
        login,
        inviteHash: 'fake-hash',
        fetchImpl: deps.fetchImpl,
        spawnImpl: deps.spawnImpl,
        checkPort: async () => undefined,
        checkOwner: async () => true,
        loadPlaywright: async () => ({ chromium: deps.browser.chromium })
      })
    ).rejects.toThrow('browser login probe failed');
    expect(deps.preview.kill).toHaveBeenCalled();
  });

  it.each(['error', 'exit'] as const)(
    'handles preview %s immediately and awaits close',
    async (event) => {
      const deps = probeDeps();
      deps.spawnImpl.mockImplementation(() => {
        queueMicrotask(() => {
          if (event === 'error' && deps.preview.listenerCount('error') === 0) {
            // Do not emit an unhandled EventEmitter error in the unfixed implementation.
            deps.preview.emit('close', 127, null);
            return;
          }
          deps.preview.emit(event, event === 'error' ? new Error('spawn rejected') : 1);
          deps.preview.emit('close', 127, null);
        });
        return deps.preview;
      });
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response('ok'));
      await expect(
        defaultLiveProbe({
          login,
          inviteHash: 'fake-hash',
          fetchImpl,
          spawnImpl: deps.spawnImpl,
          checkPort: async () => undefined,
          checkOwner: async () => true,
          loadPlaywright: async () => ({ chromium: deps.browser.chromium })
        })
      ).rejects.toThrow(/preview (launch failed|exited before readiness)/);
      expect(deps.browser.chromium.launch).not.toHaveBeenCalled();
    }
  );

  it('does not settle a failed launch until preview termination is confirmed', async () => {
    const deps = probeDeps();
    let settled = false;
    deps.preview.kill.mockImplementation(() => undefined);
    deps.spawnImpl.mockImplementation(() => {
      queueMicrotask(() => deps.preview.emit('error', new Error('spawn rejected')));
      return deps.preview;
    });
    const result = defaultLiveProbe({
      login,
      inviteHash: 'fake-hash',
      fetchImpl: deps.fetchImpl,
      spawnImpl: deps.spawnImpl,
      checkPort: async () => undefined,
      checkOwner: async () => true,
      loadPlaywright: async () => ({ chromium: deps.browser.chromium })
    }).catch((error: unknown) => {
      settled = true;
      return error;
    });
    await vi.waitFor(() => expect(deps.preview.kill).toHaveBeenCalledWith('SIGTERM'));
    expect(settled).toBe(false);
    deps.preview.emit('close', 127, null);
    expect(await result).toEqual(new IsolationProofError('preview launch failed'));
    expect(deps.browser.chromium.launch).not.toHaveBeenCalled();
  });

  it('checks TCP bindability and refuses a non-HTTP listener via EADDRINUSE', async () => {
    const server = Object.assign(new EventEmitter(), {
      listen: vi.fn<(...args: unknown[]) => void>(() => {
        queueMicrotask(() =>
          server.emit('error', Object.assign(new Error('busy'), { code: 'EADDRINUSE' }))
        );
      }),
      close: vi.fn<() => void>()
    });
    await expect(assertPreviewPortAvailable(4183, () => server)).rejects.toThrow('already in use');
    expect(server.listen).toHaveBeenCalledWith(
      { host: '127.0.0.1', port: 4183, exclusive: true },
      expect.any(Function)
    );
    expect(server.close).not.toHaveBeenCalled();
  });

  it('refuses a non-HTTP listener without making any HTTP readiness requests', async () => {
    const deps = probeDeps();
    await expect(
      defaultLiveProbe({
        login,
        inviteHash: 'fake-hash',
        fetchImpl: deps.fetchImpl,
        spawnImpl: deps.spawnImpl,
        checkPort: async () => {
          throw new IsolationProofError('TCP bind refused: already in use');
        },
        loadPlaywright: async () => ({ chromium: deps.browser.chromium })
      })
    ).rejects.toThrow('already in use');
    expect(deps.fetchImpl).not.toHaveBeenCalled();
    expect(deps.spawnImpl).not.toHaveBeenCalled();
  });

  it('reports a server that cannot verify the token as not accepted', async () => {
    const headers = new Headers({ location: 'http://127.0.0.1:4183/login?authError=1' });
    const deps = probeDeps({ callback: new Response(null, { status: 303, headers }) });
    const result = await defaultLiveProbe({
      login,
      inviteHash: 'fake-hash',
      fetchImpl: deps.fetchImpl,
      spawnImpl: deps.spawnImpl,
      checkPort: async () => undefined,
      checkOwner: async () => true,
      loadPlaywright: async () => ({ chromium: deps.browser.chromium })
    });

    expect(result.ssr).toEqual({ tokenAccepted: false, sessionCookieSet: false });
  });

  it('refuses to reuse or stop a preview port it does not own', async () => {
    const deps = probeDeps();
    const busy = vi.fn<() => Promise<void>>(async () => {
      throw new IsolationProofError('probe port is already in use (TCP bind refused)');
    });
    await expect(
      defaultLiveProbe({
        login,
        inviteHash: 'fake-hash',
        fetchImpl: deps.fetchImpl,
        spawnImpl: deps.spawnImpl,
        checkPort: busy,
        loadPlaywright: async () => ({ chromium: deps.browser.chromium })
      })
    ).rejects.toThrow(IsolationProofError);
    expect(deps.spawnImpl).not.toHaveBeenCalled();
    expect(deps.preview.kill).not.toHaveBeenCalled();
  });
});
