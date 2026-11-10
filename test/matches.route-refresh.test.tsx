/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn<() => Promise<void>>(),
  detailProps: undefined as { onRetry?: () => void | Promise<void> } | undefined
}));
vi.mock('@tanstack/react-router', async (original) => {
  const actual = await original<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useRouter: () => ({ invalidate: mocks.invalidate }),
    useChildMatches: () => false,
    createFileRoute: () => (options: object) => ({
      options,
      useLoaderData: () => ({ event: null, failed: false })
    })
  };
});
vi.mock('../src/features/matches/MatchDetailPage', () => ({
  MatchDetailPage: (props: { onRetry?: () => void | Promise<void> }) => {
    mocks.detailProps = props;
    return null;
  }
}));
import { Route } from '../src/routes/_protected.matches.$eventId';

afterEach(() => {
  cleanup();
  mocks.invalidate.mockReset();
});

function mountRoute() {
  const Component = Route.options.component;
  if (!Component) throw new Error('route component missing');
  render(<Component />);
  const onRetry = mocks.detailProps?.onRetry;
  if (!onRetry) throw new Error('onRetry not passed');
  return onRetry;
}

describe('match detail route refresh seam', () => {
  it('hands the pending invalidation to the result freshness loop', async () => {
    let settle!: () => void;
    const slow = new Promise<void>((resolve) => (settle = resolve));
    mocks.invalidate.mockReturnValue(slow);

    const pending = mountRoute()();

    expect(pending).toBe(slow);
    let done = false;
    void Promise.resolve(pending).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    settle();
    await slow;
  });

  it('propagates a failed invalidation instead of reporting instant success', async () => {
    mocks.invalidate.mockRejectedValue(new Error('reload failed'));

    await expect(Promise.resolve(mountRoute()())).rejects.toThrow('reload failed');
  });
});
