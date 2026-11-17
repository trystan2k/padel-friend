// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  buildInvitationEmailMetadata,
  invitationRedirectTo
} from '../src/features/matches/invitation-email';
import { supportedLocales } from '../src/i18n/config';
import { localAdminClient } from './helpers/match-add-player-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { requireTestEnv } from '../scripts/test-stack-env.mjs';

describe('real GoTrue invitation HTML in TEST Mailpit', () => {
  it.each(supportedLocales)('escapes hostile metadata exactly once (%s)', async (locale) => {
    const { env, reason } = localSupabaseEnv();
    if (!env) throw new Error(reason);
    const admin = localAdminClient(env);
    const email = `invitation-security-${crypto.randomUUID()}@example.test`;
    const inviterName = '<img src=x onerror=alert(1)> André "Ana" & \'João\' &lt;b&gt;';
    const venueName = '<script>alert(2)</script> Pátio & "Court"';
    const metadata = buildInvitationEmailMetadata({
      origin: 'http://127.0.0.1:4173',
      locale,
      inviterName,
      venueName,
      startsAt: 'invalid',
      timezone: 'UTC'
    });
    let userId: string | undefined;
    let messageId: string | undefined;
    const mailpit = requireTestEnv().MAILPIT_URL;
    try {
      const invited = await admin.auth.admin.inviteUserByEmail(email, {
        data: metadata,
        redirectTo: invitationRedirectTo('http://127.0.0.1:4173', 'probe')
      });
      expect(invited.error).toBeNull();
      userId = invited.data.user?.id;
      await vi.waitFor(async () => {
        const response = await fetch(
          `${mailpit}/api/v1/search?query=${encodeURIComponent('to:' + email)}`
        );
        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== 'object' ||
          !('messages' in result) ||
          !Array.isArray(result.messages)
        )
          throw new Error('Invalid Mailpit search response');
        const first: unknown = result.messages[0];
        messageId =
          first && typeof first === 'object' && 'ID' in first && typeof first.ID === 'string'
            ? first.ID
            : undefined;
        expect(messageId).toBeTruthy();
      });
      const response = await fetch(`${mailpit}/api/v1/message/${messageId}`);
      const mail: unknown = await response.json();
      if (!mail || typeof mail !== 'object' || !('HTML' in mail) || typeof mail.HTML !== 'string')
        throw new Error('Invalid Mailpit message response');
      expect(mail.HTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(mail.HTML).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
      expect(mail.HTML).toContain('&amp;lt;b&amp;gt;');
      const document = new DOMParser().parseFromString(mail.HTML, 'text/html');
      expect(document.querySelector('img, script, [onerror]')).toBeNull();
      const paragraph = document.querySelector('p');
      expect(paragraph?.textContent).toBe(metadata.padel_invite_body);
      expect(paragraph?.textContent).toContain(inviterName);
      expect(paragraph?.textContent).toContain(venueName);
      expect(document.documentElement.lang).toBe(locale);
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
      if (messageId)
        await fetch(`${mailpit}/api/v1/messages`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ IDs: [messageId] })
        });
    }
  });
});
