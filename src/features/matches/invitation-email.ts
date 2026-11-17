import { createI18n, resolveLocale } from '../../i18n/config';
import { PRIVACY_CONTACT_EMAIL } from '../privacy/privacy-content';

/**
 * Copy for the "player added by name and email" invitation, rendered per send.
 * GoTrue has one invite template (supabase/templates/invite.html) that prints
 * these user-metadata fields, so one template serves every locale. The template
 * HTML-escapes every value (verified against real GoTrue + TEST Mailpit).
 * Metadata is plain text, not HTML: pre-escaping here would double-escape names,
 * quotes, ampersands and literal entity-like input. Keep i18n escapeValue false;
 * GoTrue owns the single HTML escape at the template interpolation boundary.
 * Regression: test/auth.invitation-email.integration.test.ts.
 */
export const INVITATION_EMAIL_METADATA_KEYS = [
  'padel_invite_lang',
  'padel_invite_subject',
  'padel_invite_heading',
  'padel_invite_body',
  'padel_invite_cta',
  'padel_invite_footer',
  'padel_invite_privacy',
  'padel_invite_privacy_cta',
  'padel_invite_privacy_url'
] as const;

export type InvitationEmailMetadata = Record<
  (typeof INVITATION_EMAIL_METADATA_KEYS)[number],
  string
>;

export type InvitationEmailContext = {
  /** App origin (APP_ORIGIN): the privacy notice links to its /privacy page. */
  origin: string;
  locale: string;
  inviterName: string;
  venueName: string;
  startsAt: string;
  timezone: string;
};

function formatEventTime(locale: string, startsAt: string, timezone: string): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: timezone
    }).format(date);
  } catch {
    return '';
  }
}

export function buildInvitationEmailMetadata(
  context: InvitationEmailContext
): InvitationEmailMetadata {
  const locale = resolveLocale(context.locale);
  const { t } = createI18n(locale);
  const when = formatEventTime(locale, context.startsAt, context.timezone);
  return {
    padel_invite_lang: locale,
    padel_invite_subject: t('auth.invitationEmail.subject'),
    padel_invite_heading: t('auth.invitationEmail.heading'),
    padel_invite_body: t('auth.invitationEmail.body', {
      inviter: context.inviterName,
      event: when ? `${context.venueName} · ${when}` : context.venueName
    }),
    padel_invite_cta: t('auth.invitationEmail.cta'),
    padel_invite_footer: t('auth.invitationEmail.footer'),
    padel_invite_privacy: t('auth.invitationEmail.privacy', {
      inviter: context.inviterName,
      contact: PRIVACY_CONTACT_EMAIL
    }),
    padel_invite_privacy_cta: t('auth.invitationEmail.privacyCta'),
    padel_invite_privacy_url: new URL('/privacy', context.origin).toString()
  };
}

/** Invite link target: app auth callback, then the event the player was added to. */
export function invitationRedirectTo(origin: string, eventId: string): string {
  const callback = new URL('/auth/callback', origin);
  callback.searchParams.set('next', `/matches/${eventId}`);
  return callback.toString();
}
