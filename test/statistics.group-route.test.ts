import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ detail: vi.fn<(...args: unknown[]) => Promise<unknown>>() }));
vi.mock('../src/features/statistics/statistics-history.functions', () => ({
  getStatisticsGroupDetail: mocks.detail
}));
import { Route } from '../src/routes/_protected.matches.$eventId.groups.$groupId';

const eventId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
type Loader = (context: {
  params: { eventId: string; groupId: string };
  context: { locale: string };
}) => Promise<unknown>;
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
  if (!hasLoader(Route)) throw new Error('Missing group loader');
  return Route.options.loader;
}

describe('confirmed group route loader', () => {
  it('validates IDs and loads confirmed group detail', async () => {
    mocks.detail.mockResolvedValueOnce({ status: 'ok', value: { event_id: eventId } });
    expect(await loader()({ params: { eventId, groupId }, context: { locale: 'es' } })).toEqual({
      result: { status: 'ok', value: { event_id: eventId } },
      locale: 'es'
    });
    expect(mocks.detail).toHaveBeenCalledWith({ data: { eventId, groupId } });
  });
  it('returns not found for malformed identifiers and missing groups', async () => {
    mocks.detail.mockClear();
    await expect(
      loader()({ params: { eventId: 'bad', groupId }, context: { locale: 'en' } })
    ).rejects.toMatchObject({ isNotFound: true });
    expect(mocks.detail).not.toHaveBeenCalled();
    mocks.detail.mockResolvedValueOnce({ status: 'error', code: 'STATISTICS_NOT_FOUND' });
    await expect(
      loader()({ params: { eventId, groupId }, context: { locale: 'en' } })
    ).rejects.toMatchObject({ isNotFound: true });
  });
  it('retains typed unavailable state on reader failure', async () => {
    mocks.detail.mockRejectedValueOnce(new Error('offline'));
    expect(
      await loader()({ params: { eventId, groupId }, context: { locale: 'en' } })
    ).toMatchObject({ result: { status: 'error', code: 'STATISTICS_UNAVAILABLE' } });
  });
});
