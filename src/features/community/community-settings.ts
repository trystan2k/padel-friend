export const COMMUNITY_TIMEZONES = ['Europe/Madrid', 'UTC'] as const;
export type CommunityTimezone = (typeof COMMUNITY_TIMEZONES)[number];
export type CommunityCurrency = 'EUR';

export type CommunityAdminDefaults = {
  timezone: CommunityTimezone;
  currency: CommunityCurrency;
  member_created_leagues_enabled: boolean;
};

export const DEFAULT_COMMUNITY_ADMIN_DEFAULTS: CommunityAdminDefaults = {
  timezone: 'Europe/Madrid',
  currency: 'EUR',
  member_created_leagues_enabled: true
};

export function isCommunityAdminDefaults(value: unknown): value is CommunityAdminDefaults {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const encoder = new TextEncoder();
  const keys = Object.keys(value).sort();
  const timezone = Reflect.get(value, 'timezone');
  const currency = Reflect.get(value, 'currency');
  const leagues = Reflect.get(value, 'member_created_leagues_enabled');
  if (
    keys.join(',') !== 'currency,member_created_leagues_enabled,timezone' ||
    typeof timezone !== 'string' ||
    !COMMUNITY_TIMEZONES.some((supported) => supported === timezone) ||
    currency !== 'EUR' ||
    typeof leagues !== 'boolean' ||
    encoder.encode(JSON.stringify(value)).byteLength > 512
  )
    return false;
  try {
    const formatter = Intl.DateTimeFormat('en', { timeZone: timezone });
    formatter.format(0);
    return true;
  } catch {
    return false;
  }
}

export function parseCommunityAdminDefaults(value: unknown): CommunityAdminDefaults {
  if (!isCommunityAdminDefaults(value)) throw new Error('INVALID_COMMUNITY_ADMIN_DEFAULTS');
  return value;
}

export function formatCommunityRequestTimestamp(
  value: string,
  locale: string,
  timeZone: CommunityTimezone
): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short'
  }).format(new Date(value));
}

export function formatCommunityCurrencyPreview(
  locale: string,
  currency: CommunityCurrency
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(1234.56);
}
