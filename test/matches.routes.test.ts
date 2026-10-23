import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('match route precedence and scope', () => {
  it('declares static paths separately from UUID detail path', () => {
    const routes = ['my', 'past'].map((name) =>
      readFileSync(`src/routes/_protected.matches.${name}.tsx`, 'utf8')
    );
    expect(routes[0]).toContain("'/_protected/matches/my'");
    expect(routes[1]).toContain("'/_protected/matches/past'");
    expect(readFileSync('src/routes/_protected.matches.$eventId.tsx', 'utf8')).toContain(
      "'/_protected/matches/$eventId'"
    );
  });
  it('does not introduce unsupported ranking, filtering, booking or payment UI', () => {
    const files = [
      'src/features/matches/MatchesPage.tsx',
      'src/features/matches/MatchCard.tsx',
      'src/features/matches/MatchDetailPage.tsx'
    ];
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    // Array.filter is ordinary rendering logic, not a product filtering UI.
    expect(source.replaceAll(/\.filter\s*\(/g, '.arrayPredicate(')).not.toMatch(
      /Ranked|League|filter|booking|payment action/i
    );
  });
  it('threads the loader snapshot into every matches page as initialAsOf', () => {
    for (const name of ['index', 'my', 'past']) {
      const source = readFileSync(`src/routes/_protected.matches.${name}.tsx`, 'utf8');
      expect(source).toContain('initialAsOf={data?.as_of ?? null}');
    }
  });
});
