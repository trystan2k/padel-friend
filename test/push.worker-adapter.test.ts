// @vitest-environment node
import { createServer } from 'node:http';
import { createECDH, createPublicKey, hkdfSync, createDecipheriv, verify } from 'node:crypto';
import { once } from 'node:events';
import webPush from 'web-push';
import { unstable_dev } from 'wrangler';
import { expect, it } from 'vitest';

function decryptPush(body: Buffer, receiver: ReturnType<typeof createECDH>, auth: Buffer) {
  const salt = body.subarray(0, 16);
  const senderKey = body.subarray(21, 21 + body[20]!);
  const shared = receiver.computeSecret(senderKey);
  const ikm = hkdfSync(
    'sha256',
    shared,
    auth,
    Buffer.concat([Buffer.from('WebPush: info\0'), receiver.getPublicKey(), senderKey]),
    32
  );
  const cek = hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const encrypted = body.subarray(21 + senderKey.length);
  const decipher = createDecipheriv('aes-128-gcm', Buffer.from(cek), Buffer.from(nonce));
  decipher.setAuthTag(encrypted.subarray(-16));
  return {
    plain: Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]),
    cek: Buffer.from(cek),
    nonce: Buffer.from(nonce)
  };
}

it('independent receiver matches RFC8291 section 5 / appendix A fixture vector', () => {
  const receiver = createECDH('prime256v1');
  receiver.setPrivateKey(Buffer.from('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94', 'base64url'));
  const encoded =
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
  const { plain, cek, nonce } = decryptPush(
    Buffer.from(encoded, 'base64url'),
    receiver,
    Buffer.from('BTBZMqHH6r4Tts7J_aSIgg', 'base64url')
  );
  expect(plain.subarray(0, -1).toString()).toBe('When I grow up, I want to be a watermelon');
  expect(plain.at(-1)).toBe(2);
  expect(cek.toString('base64url')).toBe('oIhVW04MRdy2XN9CiKLxTg');
  expect(nonce.toString('base64url')).toBe('4h_95klXJ5E_qnoN');
});

// Independent RFC8291 receiver: decrypts the actual bytes sent by workerd, not a web-push mock.
it('Workers nodejs_compat sends encrypted RFC8291 payload and valid RFC8292 VAPID to local provider', async () => {
  const receiver = createECDH('prime256v1');
  receiver.generateKeys();
  const auth = Buffer.alloc(16, 7);
  const vapid = webPush.generateVAPIDKeys();
  const payload = JSON.stringify({
    notificationId: 'f74b5d16-a581-4b51-b006-805cddca5abe',
    category: 'matches',
    title: 'Update',
    body: 'Open app'
  });
  let observed: { body: Buffer; authorization: string; encoding: string } | undefined;
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    observed = {
      body: Buffer.concat(chunks),
      authorization: String(request.headers.authorization),
      encoding: String(request.headers['content-encoding'])
    };
    response.writeHead(201);
    response.end();
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const address = provider.address();
  if (!address || typeof address === 'string') throw new Error('Missing provider port');
  const worker = await unstable_dev('test/fixtures/push-worker/worker.ts', {
    config: 'test/fixtures/push-worker/wrangler.jsonc',
    port: 0,
    inspectorPort: 0,
    logLevel: 'error',
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false }
  });
  try {
    const response = await worker.fetch('/', {
      method: 'POST',
      body: JSON.stringify({
        device: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/test-vector',
          p256dh: receiver.getPublicKey().toString('base64url'),
          auth: auth.toString('base64url')
        },
        payload,
        key: { ...vapid, subject: 'mailto:operator@example.test' },
        provider: `http://127.0.0.1:${address.port}`
      })
    });
    expect(await response.json()).toEqual({ status: 201, retryAfter: null });
    expect(observed).toBeDefined();
    const { body, authorization, encoding } = observed!;
    expect(encoding).toBe('aes128gcm');
    expect(body.includes(Buffer.from(payload))).toBe(false);
    const { plain } = decryptPush(body, receiver, auth);
    expect(plain.at(-1)).toBe(2);
    expect(plain.subarray(0, -1).toString()).toBe(payload);
    const token = /t=([^, ]+)/.exec(authorization)![1]!;
    const [header, claims, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({
      aud: 'https://fcm.googleapis.com',
      sub: 'mailto:operator@example.test'
    });
    const publicBytes = Buffer.from(vapid.publicKey, 'base64url');
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: publicBytes.subarray(1, 33).toString('base64url'),
        y: publicBytes.subarray(33).toString('base64url')
      },
      format: 'jwk'
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature!, 'base64url')
      )
    ).toBe(true);
    expect(authorization).toContain(`k=${vapid.publicKey}`);
  } finally {
    await worker.stop();
    provider.close();
    await once(provider, 'close');
  }
}, 60000);
