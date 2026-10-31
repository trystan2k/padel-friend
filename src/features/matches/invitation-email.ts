import { createI18n, resolveLocale } from '../../i18n/config';

/**
 * Copy for the "player added by name and email" invitation, rendered per send.
 * GoTrue has one invite template (supabase/templates/invite.html) that prints
 * these user-metadata fields, so one template serves every locale. The template
 * HTML-escapes every value, which is why nothing here escapes.
 */
export const INVITATION_EMAIL_METADATA_KEYS = [
  'padel_invite_lang',
  'padel_invite_subject',
  'padel_invite_heading',
  'padel_invite_body',
  'padel_invite_cta',
  'padel_invite_footer'
] as const;

export type InvitationEmailMetadata = Record<
  (typeof INVITATION_EMAIL_METADATA_KEYS)[number],
  string
>;

export type InvitationEmailContext = {
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
    padel_invite_footer: t('auth.invitationEmail.footer')
  };
}

/** Invite link target: app auth callback, then the event the player was added to. */
export function invitationRedirectTo(origin: string, eventId: string): string {
  const callback = new URL('/auth/callback', origin);
  callback.searchParams.set('next', `/matches/${eventId}`);
  return callback.toString();
}
