import type { MatchEventDetail } from './match-contracts';
import { localMatchInstant, validateLocalDate, validateLocalTime } from './match-time';

export const MINOR_EDIT_KEYS = [
  'venue_name',
  'maps_url',
  'court_notes',
  'price_minor',
  'currency',
  'payment_note',
  'notes',
  'maximum_registrations',
  'registration_cutoff_at'
] as const;
export type MinorEditKey = (typeof MINOR_EDIT_KEYS)[number];
export const MATCH_EDIT_KEYS = [...MINOR_EDIT_KEYS, 'event_type', 'starts_at'] as const;
export type MatchEditFacts = Pick<MatchEventDetail, MinorEditKey | 'starts_at' | 'event_type'>;
export type MatchEditPatch = Partial<MatchEditFacts>;
export type MatchEditDraft = {
  venueName: string;
  mapsUrl: string;
  courtNotes: string;
  price: string;
  currency: 'BRL' | 'USD' | 'EUR';
  paymentNote: string;
  notes: string;
  maximumRegistrations: string;
  cutoff: string;
  startsAt: string;
  eventType: MatchEventDetail['event_type'];
};
export function hasMatchControlCharacters(value: string) {
  return value
    .split('')
    .some(
      (char) => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)
    );
}
export function validMatchMapsUrl(value: string) {
  if (value.length > 2048 || value !== value.trim() || hasMatchControlCharacters(value))
    return false;
  // Match SQL's raw host/path rules (URL parsing alone normalizes unsafe input).
  const parts = /^https:\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/.exec(value);
  if (!parts) return false;
  const host = parts[1]?.toLowerCase();
  const path = parts[2] ?? '';
  return (
    path.length > 1 &&
    ((['google.com', 'www.google.com', 'goo.gl'].some((candidate) => candidate === host) &&
      path.startsWith('/maps/')) ||
      ['maps.google.com', 'maps.app.goo.gl'].some((candidate) => candidate === host))
  );
}
export function validateEditInstant(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(value)
  )
    throw new Error('INVALID_MATCH_INPUT');
  validateLocalDate(value.slice(0, 10));
  validateLocalTime(value.slice(11, 19));
  if (!Number.isFinite(Date.parse(value))) throw new Error('INVALID_MATCH_INPUT');
  return new Date(value).toISOString();
}
export function validateMergedMatchEdit(
  current: MatchEditFacts,
  patch: MatchEditPatch,
  accepted: number,
  now = Date.now()
) {
  const merged = { ...current, ...patch };
  if ((merged.price_minor === null) !== (merged.currency === null))
    throw new Error('INVALID_MATCH_INPUT');
  const cutoff = Date.parse(merged.registration_cutoff_at);
  if (cutoff <= now || cutoff >= Date.parse(merged.starts_at)) throw new Error('FUTURE_CUTOFF');
  if (merged.maximum_registrations !== null && merged.maximum_registrations < accepted)
    throw new Error('CAPACITY_BELOW_ACCEPTED');
  return merged;
}
function localInput(instant: string, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(new Date(instant))
      .map(({ type, value }) => [type, value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
export function matchEditDraft(event: MatchEventDetail): MatchEditDraft {
  return {
    venueName: event.venue_name,
    mapsUrl: event.maps_url,
    courtNotes: event.court_notes ?? '',
    price:
      event.price_minor === null
        ? ''
        : `${Math.floor(event.price_minor / 100)}.${String(event.price_minor % 100).padStart(2, '0')}`,
    currency: event.currency ?? 'BRL',
    paymentNote: event.payment_note ?? '',
    notes: event.notes ?? '',
    maximumRegistrations:
      event.maximum_registrations === null ? '' : String(event.maximum_registrations),
    cutoff: localInput(event.registration_cutoff_at, event.timezone),
    startsAt: localInput(event.starts_at, event.timezone),
    eventType: event.event_type
  };
}
export function matchEditDraftPatch(
  draft: MatchEditDraft,
  event: MatchEventDetail
): MatchEditPatch {
  if (draft.price !== '' && !/^\d+(\.\d{1,2})?$/.test(draft.price))
    throw new Error('INVALID_MATCH_INPUT');
  const [whole = '0', fraction = ''] = draft.price.split('.');
  const price = Number(BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0')));
  const patch: MatchEditPatch = {
    event_type: draft.eventType,
    venue_name: draft.venueName,
    maps_url: draft.mapsUrl,
    court_notes: draft.courtNotes || null,
    price_minor: draft.price === '' ? null : price,
    currency: draft.price === '' ? null : draft.currency,
    payment_note: draft.paymentNote || null,
    notes: draft.notes || null,
    maximum_registrations:
      draft.maximumRegistrations === '' ? null : Number(draft.maximumRegistrations)
  };
  // Preserve sub-minute/millisecond precision when the cutoff was not edited.
  if (draft.startsAt !== localInput(event.starts_at, event.timezone))
    patch.starts_at = localMatchInstant(
      draft.startsAt.slice(0, 10),
      draft.startsAt.slice(11),
      event.timezone
    ).instant.toISOString();
  if (draft.cutoff !== localInput(event.registration_cutoff_at, event.timezone))
    patch.registration_cutoff_at = localMatchInstant(
      draft.cutoff.slice(0, 10),
      draft.cutoff.slice(11),
      event.timezone
    ).instant.toISOString();
  return patch;
}
