import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rootStyles } from '../../root.styles';
import { communityStyles } from '../community/community-surface.styles';
import { formatDisplayLevel } from '../player/rating-config';
import { NotificationBadge } from '../notifications/NotificationBadge';
import { CommunitySwitcher } from './CommunitySwitcher';
import type { HomeData } from './home-contracts';
import { ActionsSection, NextMatchSection } from './HomeSections';
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

/**
 * Home surface order (frames hKncV, AlfRD, OdU52): community pill + bell, date and greeting,
 * light level card (level, real community rank when available, reliability meter), next match
 * and attention. The bottom navigation is the protected shell's.
 */
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

  const states =
    home === null ? (
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
        {switching && <output {...stylex.props(s.state)}>{t('home.switching')}</output>}
      </>
    );
  const ready = home !== null && !switching;

  const skill =
    ready && home.ranking.status === 'ok' && home.ranking.value.skill.status === 'ok'
      ? home.ranking.value.skill.value
      : null;
  // The denominator is shown only when the read provides it; it is never derived elsewhere.
  const rank =
    skill?.status === 'ranked' && skill.position !== null
      ? {
          position: skill.position,
          total:
            skill.rankedMembers !== null && skill.rankedMembers >= skill.position
              ? skill.rankedMembers
              : null
        }
      : null;
  const numberFormat = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language);
  const reliability = Math.min(100, Math.max(0, level?.reliability_percent ?? 0));

  return (
    <div id="home-top" {...stylex.props(s.root)}>
      <div {...stylex.props(s.headerRow, rootStyles.pageHeader)}>
        {home && selectedId !== null && list.length > 0 && (
          <CommunitySwitcher
            communities={list}
            value={selectedId}
            onSelect={(target) => {
              setPending({ target, since: home.asOf });
              onSelect(target);
            }}
          />
        )}
        <div {...stylex.props(s.bellSlot)}>
          <NotificationBadge count={home?.unread ?? null} />
        </div>
      </div>
      <div {...stylex.props(s.greeting)}>
        {home && (
          <time dateTime={home.asOf} {...stylex.props(s.date)}>
            {formatHomeDate(home.asOf, i18n.language)}
          </time>
        )}
        <h1 id="home-greeting" {...stylex.props(s.greetingTitle)}>
          {displayName ? t('home.greeting', { name: displayName }) : t('home.title')}
        </h1>
      </div>
      <section aria-label={t('home.levelTitle')} {...stylex.props(s.levelCard)}>
        {level && (
          <>
            <div {...stylex.props(s.levelTop)}>
              <div {...stylex.props(s.levelMain)}>
                <p {...stylex.props(s.levelLabel)}>{t('home.levelTitle')}</p>
                <strong {...stylex.props(s.levelValue)}>
                  {formatDisplayLevel(level.display_level, i18n.language)}
                </strong>
                <span aria-hidden="true" {...stylex.props(s.ballBar)} />
              </div>
              {rank && (
                <div {...stylex.props(s.rank)}>
                  <span {...stylex.props(communityStyles.srOnly)}>
                    {rank.total !== null
                      ? t('home.ranking.skillRanked', {
                          position: numberFormat.format(rank.position),
                          total: numberFormat.format(rank.total)
                        })
                      : t('home.ranking.skillRankedNoTotal', {
                          position: numberFormat.format(rank.position)
                        })}
                  </span>
                  <span aria-hidden="true" {...stylex.props(s.rankPosition)}>
                    #{numberFormat.format(rank.position)}
                  </span>
                  {rank.total !== null && (
                    <span aria-hidden="true" {...stylex.props(s.rankTotal)}>
                      {t('home.levelSummary.rankOf', { total: numberFormat.format(rank.total) })}
                    </span>
                  )}
                </div>
              )}
            </div>
            <p {...stylex.props(s.reliability)}>
              {t('profile.reliability')}{' '}
              {t('profile.percent', { value: level.reliability_percent })}
            </p>
            <meter
              min={0}
              max={100}
              value={reliability}
              aria-label={t('profile.reliability')}
              aria-valuetext={t('profile.percent', { value: level.reliability_percent })}
              {...stylex.props(s.meter)}
            />
          </>
        )}
        <Link to="/players/$playerId" params={{ playerId }} {...stylex.props(s.link, s.statsLink)}>
          {t('statistics.player.myStatistics')}
        </Link>
      </section>
      {states}
      {ready && (
        <>
          <NextMatchSection section={home.matches} />
          <ActionsSection section={home.actions} />
        </>
      )}
    </div>
  );
}
