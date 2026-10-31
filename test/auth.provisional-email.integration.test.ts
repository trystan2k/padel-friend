import { describe, expect, it } from 'vitest';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';
import {
  addPlayer,
  authUsersByEmail,
  INVITE_ORIGIN,
  mailFor,
  patchFixtureEvent,
  uniqueEmail
} from './helpers/match-add-player-fixtures';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';
import {
  insertFixtureCommunity,
  insertFixtureEvent,
  signUpFixtureActor
} from './helpers/provisional-player-fixtures';
import { executeTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

const locales = [
  { locale: 'en', copy: en.auth.invitationEmail },
  { locale: 'pt-BR', copy: ptBR.auth.invitationEmail },
  { locale: 'es', copy: es.auth.invitationEmail }
] as const;

async function scenario(ownerName = 'Ines Inviter') {
  const env = environment.env!;
  const [admin, owner] = await Promise.all([
    signUpFixtureActor(env, 'mail-admin', { displayName: 'Mail Admin', level: 4 }),
    signUpFixtureActor(env, 'mail-owner', { displayName: ownerName, level: 4 })
  ]);
  const communityId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  await insertFixtureCommunity({
    id: communityId,
    visibility: 'private',
    adminId: admin.id,
    memberIds: [owner.id]
  });
  await insertFixtureEvent({
    id: eventId,
    communityId,
    creatorId: owner.id,
    visibility: 'community_open'
  });
  return { env, owner, eventId };
}

/** Go html/template escaping, as Auth applies it to every printed value. */
const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&#34;')
    .replaceAll("'", '&#39;');

/** The single claim link in the mail, entity-decoded the way a mail client opens it. */
function claimLink(html: string): URL {
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) =>
    match[1]!.replaceAll('&amp;', '&')
  );
  expect(links).toHaveLength(1);
  return new URL(links[0]!);
}

describe('localized invitation email for added players', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env).each(locales)(
    'sends exactly one $locale invitation naming the inviter and event',
    async ({ locale, copy }) => {
      const { env, owner, eventId } = await scenario();
      const email = uniqueEmail(`mail-${locale}`);
      const { result } = await addPlayer(env, owner, {
        eventId,
        displayName: 'Mail Max',
        email,
        level: 3,
        locale
      });
      expect(result).toEqual({ status: 'ok' });

      const mails = await mailFor(email);
      expect(mails).toHaveLength(1);
      const [mail] = mails;
      expect(mail!.subject).toBe(copy.subject);
      expect(mail!.html).toContain(`<html lang="${locale}">`);
      expect(mail!.html).toContain(escapeHtml(copy.heading));
      expect(mail!.html).toContain(escapeHtml(copy.cta));
      expect(mail!.html).toContain(escapeHtml(copy.footer));
      expect(mail!.html).toContain('Ines Inviter');
      expect(mail!.html).toContain('Provisional court');
      // The other locales' copy never leaks into this one.
      for (const other of locales.filter((candidate) => candidate.locale !== locale))
        expect(mail!.html).not.toContain(escapeHtml(other.copy.cta));

      const link = claimLink(mail!.html);
      expect(link.origin).toBe(INVITE_ORIGIN);
      expect(link.pathname).toBe('/auth/callback');
      expect(link.searchParams.get('next')).toBe(`/matches/${eventId}`);
      expect(link.searchParams.get('type')).toBe('invite');
      expect(link.searchParams.get('token_hash')).toMatch(/^[0-9a-f]{20,}$/);
      expect(await authUsersByEmail(email)).toHaveLength(1);
    }
  );

  it.skipIf(!environment.env)('escapes inviter and event names in the mail', async () => {
    const { env, owner, eventId } = await scenario('Ana <i>&</i> Co');
    await patchFixtureEvent(eventId, `venue_name = 'Tom & <b>Jerry</b> Club'`);
    const email = uniqueEmail('mail-escape');
    await addPlayer(env, owner, { eventId, displayName: 'Escape Eve', email, level: 2 });
    const [mail] = await mailFor(email);
    expect(mail!.html).toContain('Ana &lt;i&gt;&amp;&lt;/i&gt; Co');
    expect(mail!.html).toContain('Tom &amp; &lt;b&gt;Jerry&lt;/b&gt; Club');
    expect(mail!.html).not.toContain('<b>Jerry</b>');
    expect(mail!.html).not.toContain('<i>&</i>');
  });

  it.skipIf(!environment.env)(
    'resends per-event localized mail to the same identity only outside the throttle',
    async () => {
      const first = await scenario('First Adder');
      const second = await scenario('Second Adder');
      const email = uniqueEmail('mail-resend');
      await addPlayer(first.env, first.owner, {
        eventId: first.eventId,
        displayName: 'Resend Rex',
        email,
        level: 2,
        locale: 'en'
      });
      const [user] = await authUsersByEmail(email);

      // Inside the 15 minute recipient window: suppressed, no second mail.
      await addPlayer(second.env, second.owner, {
        eventId: second.eventId,
        displayName: 'Ignored',
        email,
        level: 5,
        locale: 'es'
      });
      expect(await mailFor(email)).toHaveLength(1);

      await executeTrustedSql(
        `update public.match_player_add_recipient_sends set sent_at = now() - interval '16 minutes'
          where email_digest = public.match_player_add_digest('${email}')`
      );
      const third = await scenario('Third Adder');
      await addPlayer(third.env, third.owner, {
        eventId: third.eventId,
        displayName: 'Ignored',
        email,
        level: 5,
        locale: 'pt-BR'
      });

      const mails = await mailFor(email);
      expect(mails).toHaveLength(2);
      const [original, resent] = mails;
      // Same identity, but the resend carries the new adder, locale and event: no context mixing.
      expect(await authUsersByEmail(email)).toEqual([expect.objectContaining({ id: user!.id })]);
      expect(original!.subject).toBe(en.auth.invitationEmail.subject);
      expect(original!.html).toContain('First Adder');
      expect(claimLink(original!.html).searchParams.get('next')).toBe(`/matches/${first.eventId}`);
      expect(resent!.subject).toBe(ptBR.auth.invitationEmail.subject);
      expect(resent!.html).toContain('<html lang="pt-BR">');
      expect(resent!.html).toContain('Third Adder');
      expect(resent!.html).not.toContain('First Adder');
      expect(claimLink(resent!.html).searchParams.get('next')).toBe(`/matches/${third.eventId}`);
    }
  );
});
