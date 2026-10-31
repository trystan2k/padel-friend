import { supportedLocales, type Locale } from '../../i18n/config';
import { stripEdgeWhitespace } from '../../lib/edge-whitespace';
import { validateInitialLevel } from '../player/player.validators';
import { validateMatchUuid } from './matches.validators';

export type AddMatchPlayerInput = {
  event_id: string;
  display_name: string;
  email: string;
  estimated_level: number;
  locale: Locale;
  request_id: string;
};

// Mirrors add_match_player: trimmed 1-80 code point name, trimmed lowercase
// email (dots/plus tags kept, matching Auth uniqueness), 0-7 level in tenths.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_MATCH_INPUT');
  const email = stripEdgeWhitespace(value).toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL.test(email))
    throw new Error('INVALID_MATCH_INPUT');
  return email;
}

function displayName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_MATCH_INPUT');
  const name = stripEdgeWhitespace(value);
  const length = Array.from(name).length;
  if (length < 1 || length > 80) throw new Error('INVALID_MATCH_INPUT');
  return name;
}

function estimatedLevel(value: unknown): number {
  try {
    return validateInitialLevel(value);
  } catch {
    throw new Error('INVALID_MATCH_INPUT');
  }
}

export function validateAddMatchPlayer(value: unknown): AddMatchPlayerInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_MATCH_INPUT');
  const keys = ['event_id', 'display_name', 'email', 'estimated_level', 'locale', 'request_id'];
  const data = Object.fromEntries(Object.entries(value));
  if (Object.keys(data).some((key) => !keys.includes(key))) throw new Error('INVALID_MATCH_INPUT');
  const locale = supportedLocales.find((candidate) => candidate === data.locale);
  if (!locale) throw new Error('INVALID_MATCH_INPUT');
  return {
    event_id: validateMatchUuid(data.event_id),
    display_name: displayName(data.display_name),
    email: normalizeEmail(data.email),
    estimated_level: estimatedLevel(data.estimated_level),
    locale,
    request_id: validateMatchUuid(data.request_id)
  };
}
