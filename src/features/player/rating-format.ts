import { formatDisplayLevel } from './rating-config';

// Locale-aware rating presentation. Dates are formatted in UTC so server rendering and
// hydration agree whatever the viewer's time zone is.

export const formatLevel = formatDisplayLevel;

export function formatSignedDelta(delta: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    signDisplay: 'exceptZero',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(delta);
}

export function formatAbsoluteDelta(delta: number, locale: string): string {
  return formatDisplayLevel(Math.abs(delta), locale);
}

/** Team strengths are stored with three decimals. */
export function formatTeamStrength(strength: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  }).format(strength);
}

/** Whole percent from a 0–1 fraction (expected score). */
export function formatFraction(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0
  }).format(value);
}

/** Whole percent from an already-percent integer (reliability). */
export function formatPercentPoints(value: number, locale: string): string {
  return formatFraction(value / 100, locale);
}

export function formatRatingDate(instant: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(instant)
  );
}
