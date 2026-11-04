import type { TFunction } from 'i18next';
import { formatLevel, formatRatingDate } from '../player/rating-format';

export const formatReviewDate = formatRatingDate;

/** "3.80" for an exact request, "3.80 to 4.20" for a range; numbers follow the viewer's locale. */
export function formatRequestedRange(
  request: { requested_min_level: number; requested_max_level: number },
  locale: string,
  t: TFunction
): string {
  const min = formatLevel(request.requested_min_level, locale);
  const max = formatLevel(request.requested_max_level, locale);
  return request.requested_min_level === request.requested_max_level
    ? t('levelReview.range.exact', { level: min })
    : t('levelReview.range.between', { min, max });
}
