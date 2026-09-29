export const INITIAL_SIGMA = 1.0;
export const INITIAL_RELIABILITY_PERCENT = 10;
export const INITIAL_CONFIRMED_COMPETITIVE_GAME_GROUPS = 0;
export const RATING_ENGINE = 'app-wide-level';
export const RATING_ENGINE_VERSION = '1.0.0';
export const MIN_LEVEL = 0;
export const MAX_LEVEL = 7;
export const LEVEL_STEP = 0.1;

export function formatDisplayLevel(level: number, locale = 'en'): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(level);
}
