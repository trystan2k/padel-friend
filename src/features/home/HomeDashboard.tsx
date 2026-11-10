import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rootStyles } from '../../root.styles';
import { formatDisplayLevel } from '../player/rating-config';
import { NotificationBadge } from '../notifications/NotificationBadge';
import { CommunitySwitcher } from './CommunitySwitcher';
import type { HomeData } from './home-contracts';
import { ActionsSection, ActivitySection, NextMatchSection, RankingSection } from './HomeSections';
import { homeStyles as s } from './home.styles';

/**
 * The header date is the server instant's UTC calendar day, and says so. Home has no user or
 * community timezone, so UTC is the one zone identical on server render and hydration; naming it
 * keeps the label honest near midnight instead of passing UTC off as the viewer's local day.
 */
const HOME_DATE_ZONE = 'UTC';

function formatHomeDate(instant: string, locale: string): string {
  const day = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeZone: HOME_DATE_ZONE
  }).format(new Date(instant));
  return `${day} · ${HOME_DATE_ZONE}`;
}

/** Switch in flight: community sections stay reset until a response with a newer `asOf` lands. */
type PendingSwitch = { target: string; since: string };

export function HomeDashboard({
  home,
  playerId,
  displayName,
  level,
  onSelect,
  onRetry
}: {
  /** Null when the Home read failed: shown as an error, never as empty sections. */
  home: HomeData | null;
  playerId: string;
  displayName: string | null;
  level?: { display_level: number; reliability_percent: number };
  onSelect: (communityId: string) => void;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const switching = pending !== null && home !== null && home.asOf === pending.since;
  const communities = home?.communities;
  const list = communities?.status === 'ok' ? communities.value : [];
  const selectedId = pending && switching ? pending.target : (home?.selection.selectedId ?? null);
  const selectedName = list.find(({ id }) => id === selectedId)?.name ?? null;

  return (
    <div id="home-top" {...stylex.props(s.root)}>
      <div {...stylex.props(s.headerRow, rootStyles.pageHeader)}>
        <div {...stylex.props(s.titles)}>
          <h1 {...stylex.props(s.title)}>
            {displayName ? t('home.greeting', { name: displayName }) : t('home.title')}
          </h1>
          {home && (
            <time dateTime={home.asOf} {...stylex.props(s.subtitle)}>
              {formatHomeDate(home.asOf, i18n.language)}
            </time>
          )}
          {selectedName && <p {...stylex.props(s.subtitle)}>{selectedName}</p>}
        </div>
        <NotificationBadge count={home?.unread ?? null} />
      </div>
      {level && (
        <section aria-labelledby="home-level-heading" {...stylex.props(s.levelHero)}>
          <h2 id="home-level-heading" {...stylex.props(s.cardTitle)}>
            {t('home.levelTitle')}
          </h2>
          <strong {...stylex.props(s.levelValue)}>
            {formatDisplayLevel(level.display_level, i18n.language)}
          </strong>
          <p {...stylex.props(s.heroCopy)}>
            {t('profile.reliability')}: {t('profile.percent', { value: level.reliability_percent })}
          </p>
        </section>
      )}
      <div {...stylex.props(s.quickLinks)}>
        <Link to="/matches/create" {...stylex.props(s.primaryLink)}>
          {t('matches.create')}
        </Link>
        <Link to="/matches" {...stylex.props(s.link)}>
          {t('matches.navigationLabel')}
        </Link>
        <Link to="/players/$playerId" params={{ playerId }} {...stylex.props(s.link)}>
          {t('statistics.player.myStatistics')}
        </Link>
      </div>
      {home === null ? (
        <div role="alert" {...stylex.props(s.state)}>
          <p {...stylex.props(s.body)}>{t('home.error')}</p>
          <button type="button" onClick={onRetry} {...stylex.props(s.button)}>
            {t('home.retry')}
          </button>
        </div>
      ) : (
        <>
          {home.communities.status === 'error' && (
            <p role="alert" {...stylex.props(s.state)}>
              {t('home.communitiesError')}
            </p>
          )}
          {home.communities.status === 'empty' && (
            <section aria-labelledby="home-no-community-heading" {...stylex.props(s.card)}>
              <h2 id="home-no-community-heading" {...stylex.props(s.cardTitle)}>
                {t('home.noCommunity.title')}
              </h2>
              <p {...stylex.props(s.body)}>{t('home.noCommunity.description')}</p>
              <Link to="/onboarding/community" {...stylex.props(s.link)}>
                {t('home.noCommunity.action')}
              </Link>
            </section>
          )}
          {home.selection.requestedUnavailable && (
            <output {...stylex.props(s.notice)}>{t('home.selectionUnavailable')}</output>
          )}
          {selectedId !== null && list.length > 0 && (
            <CommunitySwitcher
              communities={list}
              value={selectedId}
              onSelect={(target) => {
                setPending({ target, since: home.asOf });
                onSelect(target);
              }}
            />
          )}
          {switching ? (
            <output {...stylex.props(s.state)}>{t('home.switching')}</output>
          ) : (
            <>
              <ActionsSection section={home.actions} />
              <NextMatchSection section={home.matches} />
              <RankingSection section={home.ranking} communityId={selectedId} />
              <ActivitySection section={home.activity} />
            </>
          )}
        </>
      )}
    </div>
  );
}
