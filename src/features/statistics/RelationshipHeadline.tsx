import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { playerInitials } from '../player/player-initials';
import { ReasonText } from './StatisticsStates';
import { useRelationshipFormat } from './RelationshipRecordView';
import type { StatisticsFilters } from './statistics-contracts';
import type { RelationshipName, RelationshipRecord } from './statistics-relationship-contracts';
import { playerStyles as s } from './statistics-player.styles';
import { filterSearch } from './statistics-search';

/**
 * GrkSH / khmeK compact top bar: back chevron and title on one row, then a jump to the filter section below the summary
 * (the active-filter chips sit with that section). The back link keeps the filters in the URL.
 */
export function RelationshipTopBar({
  playerId,
  filters,
  heading,
  filtersId
}: {
  playerId: string;
  filters: StatisticsFilters;
  heading: string;
  /** Id of the filter section heading; omitted when the page offers no filter controls. */
  filtersId?: string;
}) {
  const { t } = useTranslation();
  return (
    <header {...stylex.props(s.header)}>
      <div {...stylex.props(s.topBar)}>
        <nav aria-label={t('statistics.navigation.label')}>
          <Link
            to="/players/$playerId"
            params={{ playerId }}
            search={filterSearch(filters)}
            aria-label={t('statistics.relationships.backToPlayer')}
            {...stylex.props(s.back)}
          >
            <span aria-hidden="true">‹</span>
          </Link>
        </nav>
        <h1 {...stylex.props(s.title)}>{heading}</h1>
      </div>
      {filtersId && (
        <a href={`#${filtersId}`} {...stylex.props(s.filterAccess)}>
          {t('statistics.filters.title')}
        </a>
      )}
    </header>
  );
}

const CONNECTOR = { pair: '+', opponent: null } as const;

/** The statistics DTOs carry display names only, so every avatar is the initials fallback. */
function Avatar({ name, focal }: { name: string | null; focal?: boolean }) {
  return (
    <span aria-hidden="true" {...stylex.props(s.avatar, focal && s.avatarFocal)}>
      {name ? playerInitials(name) : '?'}
    </span>
  );
}

/** GrkSH / khmeK lead: both players' avatars, then the other player's name and what the record means. */
export function RelationshipIdentity({
  kind,
  focal,
  other
}: {
  kind: 'pair' | 'opponent';
  focal: RelationshipName | undefined;
  other: RelationshipName | undefined;
}) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  const connector = CONNECTOR[kind] ?? t('statistics.relationships.opponent.versus');
  return (
    <div {...stylex.props(s.identity)}>
      <div {...stylex.props(s.avatars)}>
        <Avatar name={focal?.displayName ?? null} focal />
        <span aria-hidden="true" {...stylex.props(s.connector)}>
          {connector}
        </span>
        <Avatar name={other?.displayName ?? null} />
      </div>
      <div {...stylex.props(s.identityText)}>
        <p {...stylex.props(s.identityName)}>{f.name(other?.displayName ?? null)}</p>
        <p {...stylex.props(s.copy)}>{t(`statistics.relationships.${kind}.subtitle`)}</p>
      </div>
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div {...stylex.props(s.tile, s.tileStack)}>
      <dt {...stylex.props(s.statLabel)}>{label}</dt>
      <dd {...stylex.props(s.tileBody)}>{children}</dd>
    </div>
  );
}

/**
 * Three headline tiles from the record already served: matches (or meetings), W–L–D, then the win
 * rate for a pair or the set differential head to head. An unavailable win rate keeps its typed
 * reason instead of a number.
 */
export function RelationshipTiles({
  kind,
  record
}: {
  kind: 'pair' | 'opponent';
  record: RelationshipRecord;
}) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  const { matches, sets } = record;
  const winRate = matches.winRate;
  return (
    <section
      aria-label={t('statistics.relationships.sections.record')}
      {...stylex.props(s.section)}
    >
      <dl {...stylex.props(s.hero)}>
        <Tile
          label={t(`statistics.relationships.tiles.${kind === 'pair' ? 'matches' : 'meetings'}`)}
        >
          <strong {...stylex.props(s.tileValue)}>{f.count(matches.played)}</strong>
        </Tile>
        <Tile label={t('statistics.relationships.tiles.record')}>
          <strong {...stylex.props(s.tileValue)}>
            {[matches.wins, matches.losses, matches.draws].map((n) => f.count(n)).join('–')}
          </strong>
        </Tile>
        {kind === 'pair' ? (
          <Tile label={t('statistics.relationships.tiles.winRate')}>
            {winRate.state === 'ready' ? (
              <strong {...stylex.props(s.tileValue)}>{f.ratio(winRate.value)}</strong>
            ) : (
              <>
                <strong {...stylex.props(s.tileValue, s.valueMuted)}>
                  {t('statistics.player.noValue')}
                </strong>
                <ReasonText metric={winRate} />
              </>
            )}
          </Tile>
        ) : (
          <Tile label={t('statistics.relationships.tiles.setDiff')}>
            <strong {...stylex.props(s.tileValue)}>{f.signed(sets.differential)}</strong>
          </Tile>
        )}
      </dl>
    </section>
  );
}
