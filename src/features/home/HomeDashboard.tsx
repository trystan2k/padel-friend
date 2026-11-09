import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotificationBadge } from '../notifications/NotificationBadge';
import { CommunitySwitcher } from './CommunitySwitcher';
import type { HomeData } from './home-contracts';
import { ActionsSection, ActivitySection, NextMatchSection, RankingSection } from './HomeSections';
import { homeStyles as s } from './home.styles';

/** Switch in flight: community sections stay reset until a response with a newer `asOf` lands. */
type PendingSwitch = { target: string; since: string };

export function HomeDashboard({
  home,
  playerId,
  displayName,
  onSelect,
  onRetry
}: {
  /** Null when the Home read failed: shown as an error, never as empty sections. */
  home: HomeData | null;
  playerId: string;
  displayName: string | null;
  onSelect: (communityId: string) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const switching = pending !== null && home !== null && home.asOf === pending.since;
  const communities = home?.communities;
  const list = communities?.status === 'ok' ? communities.value : [];
  const selectedId = pending && switching ? pending.target : (home?.selection.selectedId ?? null);
  const selectedName = list.find(({ id }) => id === selectedId)?.name ?? null;

  return (
    <div id="home-top" {...stylex.props(s.root)}>
      <div {...stylex.props(s.headerRow)}>
        <div {...stylex.props(s.titles)}>
          <h1 {...stylex.props(s.title)}>{t('home.title')}</h1>
          {/* Not a heading: the profile heading below is located by the player's name. */}
          {displayName && (
            <p {...stylex.props(s.subtitle)}>{t('home.greeting', { name: displayName })}</p>
          )}
          {selectedName && <p {...stylex.props(s.subtitle)}>{selectedName}</p>}
        </div>
        <NotificationBadge count={home?.unread ?? null} />
      </div>
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
