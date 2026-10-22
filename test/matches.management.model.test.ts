import { describe, expect, it } from 'vitest';
import { matchRegistrationActionError } from '../src/features/matches/match-registration-model';
import en from '../src/locales/en/translation.json';
import pt from '../src/locales/pt-BR/translation.json';
import es from '../src/locales/es/translation.json';
import {
  MANAGEMENT_ERROR_CODES,
  managementActionError,
  parseManagementSuccess,
  parseManagementParticipants,
  parseMatchAudit,
  parseMatchEventManagement
} from '../src/features/matches/match-management-model';
import { MANAGEMENT_ERROR_COPY } from '../src/features/matches/match-management-error-copy';
import { parseMyMatchRegistration } from '../src/features/matches/match-registration-model';
const id = '11111111-1111-4111-8111-111111111111';
const success = {
  event_id: id,
  request_id: id,
  version: 1,
  transition_revision: 2,
  changed: true,
  replayed: false
};
const participant = {
  registration_id: id,
  user_id: id,
  attempt_id: id,
  display_name: null,
  display_level: 4,
  lifecycle: 'accepted',
  participation: 'reserve',
  accepted_order: 4
};
describe('management defensive models', () => {
  it('decodes accepted cancellation history without inventing a live roster position', () => {
    expect(
      parseMyMatchRegistration({
        event_id: id,
        lifecycle: 'accepted',
        registration_source: 'creator',
        event_status: 'cancelled',
        cancelled_at: '2030-01-01T00:00:00Z',
        participation: null,
        position: null
      })
    ).toEqual({
      state: 'cancelled',
      event_id: id,
      registration_source: 'creator',
      cancelled_at: '2030-01-01T00:00:00Z'
    });
  });
  it.each(['started', 'cancelled', 'result_protected', 'closed'] as const)(
    'maps shared registration guard %s instead of generic unavailable',
    (code) => {
      expect(
        matchRegistrationActionError({
          code: 'P0001',
          message: `MATCH_MANAGEMENT_${code.toUpperCase()}`
        })
      ).toEqual({ status: 'error', code });
    }
  );
  it('requires authoritative capability reasons and safe management metadata', () => {
    const dto = {
      version: 2,
      status: 'open',
      phase: 'open',
      as_of: '2030-01-01T00:00:00Z',
      owner_id: id,
      is_organizer: true,
      is_participant: false,
      results_protected: false,
      reconfirmation_generation: 0,
      required_count: 0,
      actions: Object.fromEntries(
        [
          'withdraw',
          'remove',
          'transfer',
          'cancel',
          'edit',
          'reconfirm',
          'invitation',
          'submit',
          'decision'
        ].map((action) => [action, { allowed: false, reason: 'forbidden' }])
      ),
      correction: { available: false, reason: 'results_workflow_unavailable' }
    };
    expect(parseMatchEventManagement(dto)).toEqual(dto);
    expect(parseMatchEventManagement({ ...dto, version: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
    expect(
      parseMatchEventManagement({
        ...dto,
        actions: { ...dto.actions, cancel: { allowed: true, reason: 'cancelled' } }
      })
    ).toBeNull();
    expect(parseMatchEventManagement({ ...dto, owner_id: 'invalid' })).toBeNull();
  });
  it.each(
    MANAGEMENT_ERROR_CODES.filter(
      (code) => !['unauthenticated', 'forbidden', 'invalid', 'unavailable'].includes(code)
    )
  )('maps %s with translated copy in every locale', (code) => {
    expect(
      managementActionError({ code: 'P0001', message: `MATCH_MANAGEMENT_${code.toUpperCase()}` })
    ).toEqual({ status: 'error', code });
    const key = MANAGEMENT_ERROR_COPY[code].split('.').at(-1)!;
    for (const locale of [en, pt, es])
      expect(locale.matches.management.errors).toHaveProperty(key, expect.any(String));
  });
  it('maps auth, validation, unknown and conflict errors safely', () => {
    for (const [sql, code] of [
      ['28000', 'unauthenticated'],
      ['42501', 'forbidden'],
      ['22023', 'invalid'],
      ['23514', 'invalid'],
      ['XX000', 'unavailable']
    ])
      expect(managementActionError({ code: sql, message: 'secret' })).toEqual({
        status: 'error',
        code
      });
    expect(
      managementActionError({
        code: 'P0001',
        message: 'MATCH_MANAGEMENT_VERSION_CONFLICT',
        details: '{"current_version":3}'
      })
    ).toEqual({ status: 'conflict', code: 'version_conflict', current_version: 3 });
    expect(
      managementActionError({
        code: 'P0001',
        message: 'MATCH_MANAGEMENT_VERSION_CONFLICT',
        details: 'secret'
      })
    ).toEqual({ status: 'error', code: 'unavailable' });
  });
  it('decodes envelope and rejects malformed primitive fields', () => {
    expect(parseManagementSuccess(success)).toMatchObject({
      status: 'ok',
      replayed: false,
      value: { transition_revision: 2 }
    });
    for (const patch of [
      { event_id: 'bad' },
      { version: 0 },
      { transition_revision: -1 },
      { changed: 1 },
      { replayed: undefined }
    ])
      expect(parseManagementSuccess({ ...success, ...patch })).toBeNull();
  });
  it('projects only allowed management participant fields', () => {
    expect(parseManagementParticipants([{ ...participant, secret: 'hidden' }])).toEqual([
      participant
    ]);
    for (const patch of [
      { attempt_id: null },
      { user_id: 'bad' },
      { accepted_order: 0 },
      { display_level: NaN },
      { lifecycle: 'withdrawn' },
      { participation: null }
    ])
      expect(parseManagementParticipants([{ ...participant, ...patch }])).toBeNull();
    expect(parseManagementParticipants({})).toBeNull();
    expect(parseMatchAudit([{}])).toBeNull();
  });
  it('decodes own terminal history and never accepts terminal participation', () => {
    const own = {
      event_id: id,
      attempt_id: id,
      lifecycle: 'withdrawn',
      participation: null,
      accepted_order: 2,
      accepted_at: '2030-01-01T00:00:00Z',
      left_at: '2030-01-02T00:00:00Z',
      registration_source: 'member',
      removal_reason: null
    };
    expect(parseMyMatchRegistration(own)).toMatchObject({ state: 'withdrawn', accepted_order: 2 });
    expect(parseMyMatchRegistration({ ...own, participation: 'playing' })).toBeNull();
    expect(
      parseMyMatchRegistration({
        ...own,
        lifecycle: 'removed_by_creator',
        removal_reason: 'Cannot attend'
      })
    ).toMatchObject({ state: 'removed_by_creator', removal_reason: 'Cannot attend' });
  });
});
