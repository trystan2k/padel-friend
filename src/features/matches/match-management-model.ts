import type { MatchRegistrationParticipation } from './match-registration-model';
import type { Json } from '../../lib/supabase/database.types';

export const MANAGEMENT_ERROR_CODES = [
  'closed',
  'started',
  'cancelled',
  'result_protected',
  'target_not_accepted',
  'stale_attempt',
  'stale_generation',
  'capacity_below_accepted',
  'idempotency_conflict',
  'already_resolved',
  'not_found',
  'unauthenticated',
  'forbidden',
  'invalid',
  'unavailable'
] as const;
export type ManagementErrorCode = (typeof MANAGEMENT_ERROR_CODES)[number];
export type ManagementResult<T> =
  | { status: 'ok'; value: T; replayed: boolean }
  | { status: 'conflict'; code: 'version_conflict'; current_version: number }
  | { status: 'error'; code: ManagementErrorCode };
export type ManagementSuccess = {
  event_id: string;
  version: number;
  transition_revision: number;
  request_id: string;
  changed: boolean;
};
export type OwnershipSuccess = ManagementSuccess & { owner_id: string };
export type CancellationSuccess = ManagementSuccess & { status: 'cancelled' };
export function parseOwnershipSuccess(value: unknown): ManagementResult<OwnershipSuccess> | null {
  const parsed = parseManagementSuccess(value);
  return parsed?.status === 'ok' && record(value) && isUuid(value.owner_id)
    ? { ...parsed, value: { ...parsed.value, owner_id: value.owner_id } }
    : null;
}
export function parseCancellationSuccess(
  value: unknown
): ManagementResult<CancellationSuccess> | null {
  const parsed = parseManagementSuccess(value);
  return parsed?.status === 'ok' && record(value) && value.status === 'cancelled'
    ? { ...parsed, value: { ...parsed.value, status: 'cancelled' } }
    : null;
}
export type ManagementParticipant = {
  registration_id: string;
  user_id: string;
  attempt_id: string;
  display_name: string | null;
  display_level: number | null;
  lifecycle: 'accepted';
  participation: MatchRegistrationParticipation;
  accepted_order: number;
};
export type MatchAuditEntry = {
  id: string;
  match_event_id: string;
  community_id: string;
  actor_id: string | null;
  target_user_id: string | null;
  action: string;
  reason: string | null;
  request_id: string | null;
  occurred_at: string;
  event_version: number | null;
  transition_revision: number;
  before_data: { [key: string]: Json | undefined };
  after_data: { [key: string]: Json | undefined };
  changed_fields: string[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function jsonObject(value: unknown): value is { [key: string]: Json | undefined } {
  const valid = (item: unknown): item is Json =>
    item === null ||
    typeof item === 'string' ||
    typeof item === 'boolean' ||
    (typeof item === 'number' && Number.isFinite(item)) ||
    (Array.isArray(item) && item.every(valid)) ||
    (record(item) && Object.values(item).every(valid));
  return record(value) && Object.values(value).every(valid);
}
export function managementActionError(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}): ManagementResult<never> {
  if (error.code === 'P0001' && error.message?.startsWith('MATCH_MANAGEMENT_')) {
    const code = error.message.slice('MATCH_MANAGEMENT_'.length).toLowerCase();
    if (code === 'version_conflict') {
      let version: unknown;
      try {
        const detail: unknown = JSON.parse(error.details ?? 'null');
        version = record(detail) ? detail.current_version : detail;
      } catch {
        version = null;
      }
      if (integer(version, 1)) return { status: 'conflict', code, current_version: version };
    }
    const known = MANAGEMENT_ERROR_CODES.find((candidate) => candidate === code);
    if (known) return { status: 'error', code: known };
  }
  const code =
    error.code === '28000'
      ? 'unauthenticated'
      : error.code === '42501'
        ? 'forbidden'
        : error.code === '22023' || error.code === '23514'
          ? 'invalid'
          : 'unavailable';
  return { status: 'error', code };
}

export type ManagementAction = 'withdraw' | 'remove' | 'transfer' | 'cancel';
export type MatchEventManagement = {
  version: number;
  status: 'open' | 'cancelled';
  phase: 'open' | 'awaiting_results' | 'incomplete' | 'started' | 'cancelled';
  as_of: string;
  owner_id: string;
  is_organizer: boolean;
  is_participant: boolean;
  results_protected: boolean;
  reconfirmation_generation: number;
  required_count: number;
  actions: Record<ManagementAction, { allowed: boolean; reason: ManagementErrorCode | null }>;
  correction: { available: false; reason: 'results_workflow_unavailable' };
};
export function parseMatchEventManagement(value: unknown): MatchEventManagement | null {
  if (
    !record(value) ||
    !integer(value.version, 1) ||
    !isUuid(value.owner_id) ||
    !(value.status === 'open' || value.status === 'cancelled') ||
    !(
      value.phase === 'open' ||
      value.phase === 'awaiting_results' ||
      value.phase === 'incomplete' ||
      value.phase === 'started' ||
      value.phase === 'cancelled'
    ) ||
    typeof value.as_of !== 'string' ||
    !Number.isFinite(Date.parse(value.as_of)) ||
    typeof value.is_organizer !== 'boolean' ||
    typeof value.is_participant !== 'boolean' ||
    typeof value.results_protected !== 'boolean' ||
    !integer(value.reconfirmation_generation) ||
    !integer(value.required_count) ||
    !record(value.actions) ||
    !record(value.correction) ||
    value.correction.available !== false ||
    value.correction.reason !== 'results_workflow_unavailable'
  )
    return null;
  const actions: MatchEventManagement['actions'] = {
    withdraw: { allowed: false, reason: 'unavailable' },
    remove: { allowed: false, reason: 'unavailable' },
    transfer: { allowed: false, reason: 'unavailable' },
    cancel: { allowed: false, reason: 'unavailable' }
  };
  for (const action of ['withdraw', 'remove', 'transfer', 'cancel'] as const) {
    const capability = value.actions[action];
    const reason = record(capability)
      ? MANAGEMENT_ERROR_CODES.find((code) => code === capability.reason)
      : undefined;
    if (
      !record(capability) ||
      typeof capability.allowed !== 'boolean' ||
      !(
        capability.reason === null ||
        MANAGEMENT_ERROR_CODES.some((code) => code === capability.reason)
      ) ||
      capability.allowed !== (capability.reason === null)
    )
      return null;
    actions[action] = { allowed: capability.allowed, reason: reason ?? null };
  }
  return {
    version: value.version,
    status: value.status,
    phase: value.phase,
    as_of: value.as_of,
    owner_id: value.owner_id,
    is_organizer: value.is_organizer,
    is_participant: value.is_participant,
    results_protected: value.results_protected,
    reconfirmation_generation: value.reconfirmation_generation,
    required_count: value.required_count,
    actions,
    correction: { available: false, reason: 'results_workflow_unavailable' }
  };
}
export function parseManagementSuccess(value: unknown): ManagementResult<ManagementSuccess> | null {
  if (
    !record(value) ||
    !isUuid(value.event_id) ||
    !isUuid(value.request_id) ||
    !integer(value.version, 1) ||
    !integer(value.transition_revision) ||
    typeof value.changed !== 'boolean' ||
    typeof value.replayed !== 'boolean'
  )
    return null;
  return {
    status: 'ok',
    replayed: value.replayed,
    value: {
      event_id: value.event_id,
      request_id: value.request_id,
      version: value.version,
      transition_revision: value.transition_revision,
      changed: value.changed
    }
  };
}
export function parseManagementParticipants(value: unknown): ManagementParticipant[] | null {
  if (!Array.isArray(value)) return null;
  const entries: ManagementParticipant[] = [];
  for (const row of value) {
    if (
      !record(row) ||
      !isUuid(row.registration_id) ||
      !isUuid(row.user_id) ||
      !isUuid(row.attempt_id) ||
      row.lifecycle !== 'accepted' ||
      !integer(row.accepted_order, 1) ||
      !(row.display_name === null || typeof row.display_name === 'string') ||
      !(
        row.display_level === null ||
        (typeof row.display_level === 'number' && Number.isFinite(row.display_level))
      ) ||
      !(
        row.participation === 'playing' ||
        row.participation === 'reserve' ||
        row.participation === 'reserve_not_playing'
      )
    )
      return null;
    entries.push({
      registration_id: row.registration_id,
      user_id: row.user_id,
      attempt_id: row.attempt_id,
      lifecycle: row.lifecycle,
      display_name: row.display_name,
      display_level: row.display_level,
      participation: row.participation,
      accepted_order: row.accepted_order
    });
  }
  return entries;
}
export function parseMatchAudit(value: unknown): MatchAuditEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: MatchAuditEntry[] = [];
  for (const row of value) {
    if (
      !record(row) ||
      !isUuid(row.id) ||
      !isUuid(row.match_event_id) ||
      !isUuid(row.community_id) ||
      !(row.actor_id === null || isUuid(row.actor_id)) ||
      !(row.target_user_id === null || isUuid(row.target_user_id)) ||
      !(row.request_id === null || isUuid(row.request_id)) ||
      typeof row.action !== 'string' ||
      ![
        'withdraw',
        'remove',
        'transfer',
        'cancel',
        'minor_edit',
        'major_edit',
        'reconfirm',
        'reconfirmation_excluded'
      ].includes(row.action) ||
      !(row.reason === null || typeof row.reason === 'string') ||
      typeof row.occurred_at !== 'string' ||
      !Number.isFinite(Date.parse(row.occurred_at)) ||
      !(row.event_version === null || integer(row.event_version, 1)) ||
      !integer(row.transition_revision) ||
      !jsonObject(row.before_data) ||
      !jsonObject(row.after_data) ||
      !Array.isArray(row.changed_fields) ||
      !row.changed_fields.every((key): key is string => typeof key === 'string')
    )
      return null;
    entries.push({
      id: row.id,
      match_event_id: row.match_event_id,
      community_id: row.community_id,
      actor_id: row.actor_id,
      target_user_id: row.target_user_id,
      request_id: row.request_id,
      action: row.action,
      reason: row.reason,
      occurred_at: row.occurred_at,
      event_version: row.event_version,
      transition_revision: row.transition_revision,
      before_data: row.before_data,
      after_data: row.after_data,
      changed_fields: row.changed_fields
    });
  }
  return entries;
}
