import {
  createPushTransport,
  type PushDevice,
  type VapidKey
} from '../../../src/features/notifications/push-transport.server';

// Isolated wrangler fixture, never imported by application/build. Outbound HTTP still crosses workerd.
export default {
  async fetch(request: Request) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted isolated checkpoint request
    const input = (await request.json()) as {
      device: PushDevice;
      payload: string;
      key: VapidKey;
      provider: string;
    };
    const transport = createPushTransport((_url, options) => fetch(input.provider, options));
    return Response.json(await transport(input.device, input.payload, input.key));
  }
};
