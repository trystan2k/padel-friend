import { formatCommunityRequestTimestamp, type CommunityTimezone } from './community-settings';

export function dateLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(value)
  );
}

export function communityDateLabel(value: string, locale: string, timeZone: CommunityTimezone) {
  return formatCommunityRequestTimestamp(value, locale, timeZone);
}

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase())
    .join('');
}

export function failed(error: unknown) {
  if (!(error instanceof Error)) return 'generic';
  if (error.message === 'UNAUTHENTICATED') return 'session';
  if (error.message === 'FINAL_COMMUNITY_ADMIN') return 'finalAdmin';
  if (error.message === 'INVALID_MEMBERSHIP_TRANSITION') return 'transition';
  return 'generic';
}
