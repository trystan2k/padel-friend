import { describe, expect, it } from 'vitest';
import {
  invitationActionError,
  MATCH_INVITATION_ERROR_COPY,
  parseInvitationResult,
  parseMatchInvitation
} from '../src/features/matches/match-invitation-model';
import en from '../src/locales/en/translation.json';
import pt from '../src/locales/pt-BR/translation.json';
import es from '../src/locales/es/translation.json';
const id = '11111111-1111-4111-8111-111111111111';
const now = '2030-01-01T00:00:00Z';
describe('invitation model', () => {
  it('maps ordinary submission outcomes and terminal invitation errors', () => {
    for (const key of Object.values(MATCH_INVITATION_ERROR_COPY)) {
      const suffix = key.slice('matches.invitations.errors.'.length);
      for (const locale of [en, pt, es])
        expect(locale.matches.invitations.errors).toHaveProperty(suffix);
    }
    const cases = [
      ['MATCH_INVITATION_EXPIRED', 'expired'],
      ['MATCH_INVITATION_ALREADY_RESOLVED', 'already_resolved'],
      ['MATCH_INVITATION_NOT_FOUND', 'not_found'],
      ['MATCH_REGISTRATION_EVENT_NOT_FOUND', 'event_not_found'],
      ['MATCH_REGISTRATION_FULL', 'full'],
      ['MATCH_REGISTRATION_DENIED', 'denied'],
      ['MATCH_REGISTRATION_REQUESTER_INELIGIBLE', 'requester_ineligible'],
      ['MATCH_REGISTRATION_INVITE_ONLY', 'invite_only'],
      ['MATCH_REGISTRATION_CLOSED', 'closed'],
      ['MATCH_REGISTRATION_DUPLICATE', 'duplicate'],
      ['MATCH_REGISTRATION_PENDING_DUPLICATE', 'pending_duplicate'],
      ['MATCH_REGISTRATION_NOT_FOUND', 'not_found'],
      ['MATCH_REGISTRATION_ALREADY_RESOLVED', 'already_resolved']
    ];
    for (const [message, code] of cases) {
      expect(invitationActionError({ code: 'P0001', message })).toEqual({ status: 'error', code });
      const key = code!.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      for (const locale of [en, pt, es])
        expect(locale.matches.invitations.errors).toHaveProperty(key);
    }
    for (const [code, expected] of [
      ['28000', 'unauthenticated'],
      ['42501', 'forbidden'],
      ['22023', 'invalid'],
      ['23514', 'invalid'],
      ['unknown', 'unavailable']
    ])
      expect(invitationActionError({ code })).toEqual({ status: 'error', code: expected });
  });
  it('decodes original acceptance snapshot', () => {
    const registration = {
      event_id: id,
      user_id: id,
      lifecycle: 'accepted',
      participation: 'reserve',
      accepted_order: 7,
      registration_source: 'member',
      accepted_at: now,
      approved_at: null
    };
    const value = {
      event_id: id,
      invitation_id: id,
      status: 'accepted',
      registration,
      replayed: true
    };
    expect(parseInvitationResult(value)).toEqual(value);
    expect(
      parseInvitationResult({
        ...value,
        registration: { ...registration, lifecycle: 'pending', requested_at: now }
      })
    ).toMatchObject({ status: 'accepted', registration: { lifecycle: 'pending' } });
    for (const bad of [
      null,
      {},
      { ...value, replayed: 'true' },
      { ...value, registration: null },
      { ...value, status: 'declined' },
      { ...value, registration: { ...registration, accepted_at: 'not-a-date' } },
      { ...value, registration: { ...registration, approved_at: 'not-a-date' } }
    ])
      expect(parseInvitationResult(bad)).toBeNull();
    for (const status of ['declined', 'expired'])
      expect(parseInvitationResult({ ...value, status, registration: null })).toMatchObject({
        status,
        registration: null
      });
  });
  it('decodes effective expiry without accepting malformed read data', () => {
    const value = {
      invitation_id: id,
      status: 'pending',
      effective_status: 'expired',
      expires_at: now,
      responded_at: null
    };
    expect(parseMatchInvitation(value)).toEqual(value);
    for (const bad of [
      null,
      [],
      {},
      { ...value, expires_at: 'bad' },
      { ...value, status: 'declined' },
      { ...value, responded_at: 1 },
      { ...value, responded_at: now },
      { ...value, status: 'accepted', effective_status: 'accepted', responded_at: null }
    ])
      expect(parseMatchInvitation(bad)).toBeNull();
  });
});
