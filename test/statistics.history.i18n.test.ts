import { describe, expect, it } from 'vitest';
import en from '../src/locales/en/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';
import es from '../src/locales/es/translation.json';
import { HISTORY_STATUSES } from '../src/features/statistics/statistics-history-contracts';

const locales = { en, 'pt-BR': ptBR, es };
function leaves(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix ? prefix + '.' + key : key)
  );
}

describe('statistics history translations', () => {
  it.each(Object.entries(locales))('%s provides every history and detail key', (_locale, data) => {
    const expected = leaves(en.statistics).sort();
    expect(leaves(data.statistics).sort()).toEqual(expected);
    for (const status of HISTORY_STATUSES) {
      expect(data.statistics.history.status[status].trim()).not.toBe('');
      expect(data.statistics.history.statusHelp[status].trim()).not.toBe('');
    }
    for (const type of ['competitive', 'friendly'] as const)
      expect(data.matches.type[type].trim()).not.toBe('');
    for (const key of ['manual', 'automatic'] as const)
      expect(data.statistics.detail.confirmation[key].trim()).not.toBe('');
    for (const key of ['friendly', 'incomplete', 'not_rated', 'missing_evidence'] as const)
      expect(data.statistics.detail.rating.absent[key].trim()).not.toBe('');
    for (const key of [
      'empty',
      'loadMore',
      'loadingMore',
      'retry',
      'listLabel',
      'detailsLabel',
      'matchLabel'
    ] as const)
      expect(data.statistics.history[key].trim()).not.toBe('');
    for (const message of Object.values(data.statistics.errors))
      expect(message.trim()).not.toBe('');
  });
});
