import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { supportedLocales } from '../src/i18n/config';
import {
  buildInvitationEmailMetadata,
  INVITATION_EMAIL_METADATA_KEYS,
  invitationRedirectTo
} from '../src/features/matches/invitation-email';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';

const context = {
  locale: 'en',
  inviterName: 'Ines Inviter',
  venueName: 'Central Court',
  startsAt: '2026-11-05T18:30:00Z',
  timezone: 'UTC'
};

describe('invitation email metadata', () => {
  it('renders localized copy naming the inviter and event for every locale', () => {
    const subjects = new Set<string>();
    for (const locale of supportedLocales) {
      const metadata = buildInvitationEmailMetadata({ ...context, locale });
      expect(Object.keys(metadata).sort()).toEqual([...INVITATION_EMAIL_METADATA_KEYS].sort());
      expect(metadata.padel_invite_lang).toBe(locale);
      expect(metadata.padel_invite_body).toContain('Ines Inviter');
      expect(metadata.padel_invite_body).toContain('Central Court');
      expect(metadata.padel_invite_body).not.toContain('{{');
      subjects.add(metadata.padel_invite_subject);
    }
    expect(subjects.size).toBe(supportedLocales.length);
  });

  it('formats the event time in the event timezone and recipient locale', () => {
    const utc = buildInvitationEmailMetadata({ ...context, locale: 'es' });
    const tokyo = buildInvitationEmailMetadata({
      ...context,
      locale: 'es',
      timezone: 'Asia/Tokyo'
    });
    expect(utc.padel_invite_body).toContain('jueves');
    expect(utc.padel_invite_body).toContain('18:30');
    expect(tokyo.padel_invite_body).toContain('viernes');
    expect(tokyo.padel_invite_body).toContain('3:30');
  });

  it('falls back to English for unsupported locales and omits an unusable time', () => {
    expect(buildInvitationEmailMetadata({ ...context, locale: 'fr' }).padel_invite_lang).toBe('en');
    const body = buildInvitationEmailMetadata({
      ...context,
      startsAt: 'not-a-date'
    }).padel_invite_body;
    expect(body).toContain('Central Court');
    expect(body).not.toContain('Invalid');
    expect(
      buildInvitationEmailMetadata({ ...context, timezone: 'Not/AZone' }).padel_invite_body
    ).toContain('Central Court');
  });

  it('does not escape names; the Auth template does', () => {
    const metadata = buildInvitationEmailMetadata({ ...context, inviterName: 'A <b>&</b>' });
    expect(metadata.padel_invite_body).toContain('A <b>&</b>');
  });

  it('keeps subjects free of HTML-special characters, which Auth escapes in subjects', () => {
    for (const copy of [en, ptBR, es])
      expect(copy.auth.invitationEmail.subject).not.toMatch(/[<>&'"]/);
  });

  it('has the same invitation keys in every locale', () => {
    const keys = Object.keys(en.auth.invitationEmail).sort();
    expect(keys).toEqual(['body', 'cta', 'footer', 'heading', 'subject']);
    expect(Object.keys(ptBR.auth.invitationEmail).sort()).toEqual(keys);
    expect(Object.keys(es.auth.invitationEmail).sort()).toEqual(keys);
  });
});

describe('invitation redirect', () => {
  it('points at the auth callback with the event as return path', () => {
    const url = new URL(invitationRedirectTo('https://app.example.com', 'event-1'));
    expect(url.origin).toBe('https://app.example.com');
    expect(url.pathname).toBe('/auth/callback');
    expect(url.searchParams.get('next')).toBe('/matches/event-1');
  });
});

describe('Auth invite template wiring', () => {
  const template = readFileSync('supabase/templates/invite.html', 'utf8');
  const config = readFileSync('supabase/config.toml', 'utf8');

  it('prints every metadata key and exactly one verification link', () => {
    // The subject lives in config.toml; every other key is printed by the template.
    for (const key of INVITATION_EMAIL_METADATA_KEYS.filter(
      (name) => name !== 'padel_invite_subject'
    ))
      expect(template).toContain(`.Data.${key}`);
    expect(template.match(/<a /g)).toHaveLength(1);
    expect(template).toContain('{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite');
  });

  it('registers the template and a metadata-driven subject for local Auth', () => {
    expect(config).toContain('[auth.email.template.invite]');
    expect(config).toContain('subject = "{{ .Data.padel_invite_subject }}"');
    expect(config).toContain('content_path = "./supabase/templates/invite.html"');
  });
});
