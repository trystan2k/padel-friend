import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBrowserClient } from '../../lib/supabase/client';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { PlatformAdminEntry } from '../level-reviews/PlatformAdminEntry';
import { cleanupPushDeviceForLogout } from '../notifications/push-browser';
import type { MeStatistics } from './me-statistics';
import type { updateMyPlayerProfile } from './player.functions';
import { ProfileEditForm } from './ProfileEditForm';
import { playerInitials } from './player-initials';
import { formatDisplayLevel, MAX_LEVEL, MIN_LEVEL } from './rating-config';
import type { RatingLoad } from './rating-view';
import { RatingJourney } from './RatingJourney';
import { me as s } from './me.styles';
import { ui } from './player-ui.styles';

type Profile = Awaited<ReturnType<typeof updateMyPlayerProfile>>;

// Row glyphs of frame vARtQ (24px stroke icons); decorative, the row text carries the name.
const ICONS = {
  statistics: 'M3 3v16a2 2 0 0 0 2 2h16M18 17V9M13 17V5M8 17v-3',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2',
  scale: 'M12 3v18M7 21h10M5 7h14M5 7l-3 8a3 3 0 0 0 6 0L5 7zM19 7l-3 8a3 3 0 0 0 6 0l-3-8z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0'
} as const;

function RowIcon({ d }: { d: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...stylex.props(s.rowIcon)}
    >
      <path d={d} />
    </svg>
  );
}

function MeStatisticsTiles({ statistics, locale }: { statistics: MeStatistics; locale: string }) {
  const { t } = useTranslation();
  if (statistics.status === 'unavailable')
    return <p {...stylex.props(s.statsUnavailable)}>{t('profile.stats.unavailable')}</p>;
  const count = new Intl.NumberFormat(locale);
  const tiles = [
    { key: 'matches', value: count.format(statistics.played) },
    {
      key: 'record',
      value: [statistics.wins, statistics.losses, statistics.draws]
        .map((value) => count.format(value))
        .join('–')
    },
    {
      key: 'winRate',
      value:
        statistics.winRate === null
          ? null
          : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
              statistics.winRate
            )
    }
  ] as const;
  return (
    <dl aria-label={t('profile.stats.label')} {...stylex.props(s.stats)}>
      {tiles.map(({ key, value }) => (
        <div key={key} data-stat={key} {...stylex.props(s.statTile)}>
          <dt {...stylex.props(s.statLabel)}>{t(`profile.stats.${key}`)}</dt>
          <dd {...stylex.props(s.statValue)}>
            {value ?? (
              <>
                <span aria-hidden="true">—</span>
                <span {...stylex.props(s.srOnly)}>{t('profile.stats.notAvailable')}</span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PlayerProfile({
  initialProfile,
  initialRating,
  onRatingReload,
  platformAdmin = false,
  statistics
}: {
  initialProfile: Profile;
  initialRating: RatingLoad;
  onRatingReload: () => void;
  /** Server-reported platform-admin access (`get_level_review_access`), never a client guess. */
  platformAdmin?: boolean;
  /** The one own-profile statistics read (default scope); absent hides the tiles. */
  statistics?: MeStatistics;
}) {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState(initialProfile);
  const [editing, setEditing] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const reviewId = useId();
  // Level figures come from the same committed projection as the chart and history; the
  // profile row is only the fallback when that read failed.
  const level = (initialRating.status === 'ok' ? initialRating.summary.summary : null) ?? profile;
  const joined = new Intl.DateTimeFormat(i18n.language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(profile.joined_at));

  const listFormat = new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' });
  const listChoices = (values: readonly string[] | null, prefix: string) =>
    values?.length
      ? listFormat.format(values.map((value) => t(`${prefix}.${value}`)))
      : t('profile.availabilityNotProvided');

  const levelPercent = ((level.display_level - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL)) * 100;
  const sideLabel = t(
    profile.preferred_side === 'LEFT'
      ? 'onboarding.sideLeft'
      : profile.preferred_side === 'RIGHT'
        ? 'onboarding.sideRight'
        : 'onboarding.sideEither'
  );
  if (editing)
    return (
      <ProfileEditForm
        profile={profile}
        onProfileChange={setProfile}
        onSaved={(next) => {
          setProfile(next);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  return (
    <main {...stylex.props(s.page)}>
      <h1 {...stylex.props(s.srOnly)}>{t('profile.title')}</h1>
      <header {...stylex.props(s.identity)}>
        {profile.avatar_signed_url ? (
          <img
            src={profile.avatar_signed_url}
            alt={t('profile.avatarAlt', { name: profile.display_name })}
            {...stylex.props(s.avatar)}
          />
        ) : (
          <span aria-hidden="true" {...stylex.props(s.avatar)}>
            {playerInitials(profile.display_name)}
          </span>
        )}
        <div {...stylex.props(s.identityText)}>
          <h2 {...stylex.props(s.name)}>{profile.display_name}</h2>
          <p {...stylex.props(s.meta)}>
            {sideLabel} · {t('profile.joinedOn', { date: joined })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={t('profile.edit')}
          {...stylex.props(s.editButton)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...stylex.props(s.editIcon)}
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.9l.06.06-1.9 1.9-.06-.06a1.7 1.7 0 0 0-1.9-.34 1.7 1.7 0 0 0-1 1.55V21h-2.7v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.9.34l-.06.06-1.9-1.9.06-.06A1.7 1.7 0 0 0 7.8 15a1.7 1.7 0 0 0-1.55-1H6v-2.7h.25a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.9L7.4 8.34l1.9-1.9.06.06a1.7 1.7 0 0 0 1.9.34 1.7 1.7 0 0 0 1-1.55V5h2.7v.29a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.9-.34l.06-.06 1.9 1.9-.06.06a1.7 1.7 0 0 0-.34 1.9 1.7 1.7 0 0 0 1.55 1H21V14h-.03a1.7 1.7 0 0 0-1.57 1Z" />
          </svg>
        </button>
      </header>
      {statistics && <MeStatisticsTiles statistics={statistics} locale={i18n.language} />}
      <SurfaceCard>
        <div {...stylex.props(s.levelTop)}>
          <div {...stylex.props(s.levelHeader)}>
            <span {...stylex.props(s.levelLabel)}>{t('profile.globalLevel')}</span>
            <strong {...stylex.props(s.levelMetric)}>
              {formatDisplayLevel(level.display_level, i18n.language)}
            </strong>
          </div>
          <strong {...stylex.props(s.reliability)}>
            {t('profile.reliability')}: {t('profile.percent', { value: level.reliability_percent })}
          </strong>
        </div>
        <progress
          aria-label={t('profile.levelScale')}
          max={MAX_LEVEL}
          value={level.display_level}
          {...stylex.props(s.srOnly)}
        />
        <div aria-hidden="true" {...stylex.props(s.progressTrack)}>
          <div {...stylex.props(s.progressFill)} style={{ width: `${levelPercent}%` }} />
        </div>
        <div {...stylex.props(s.scaleCaption)}>
          <span {...stylex.props(s.scaleEndpoint)}>
            {formatDisplayLevel(MIN_LEVEL, i18n.language)}
          </span>
          <span>{t('profile.levelScale')}</span>
          <span {...stylex.props(s.scaleEndpoint)}>
            {formatDisplayLevel(MAX_LEVEL, i18n.language)}
          </span>
        </div>
        <div {...stylex.props(s.fact)}>
          <span>{t('profile.initialLevel')}</span>
          <strong>{formatDisplayLevel(level.initial_display_level, i18n.language)}</strong>
        </div>
        <div {...stylex.props(s.fact)}>
          <span>{t('profile.highestLevel')}</span>
          <strong>{formatDisplayLevel(level.highest_display_level, i18n.language)}</strong>
        </div>
        <div {...stylex.props(s.fact)}>
          <span>{t('profile.confirmedGroups')}</span>
          <strong>{level.confirmed_competitive_game_groups}</strong>
        </div>
      </SurfaceCard>
      <nav aria-label={t('profile.links.label')}>
        <ul {...stylex.props(s.list)}>
          <li {...stylex.props(s.listItem)}>
            <Link
              to="/players/$playerId"
              params={{ playerId: profile.user_id }}
              {...stylex.props(s.row)}
            >
              <RowIcon d={ICONS.statistics} />
              <span {...stylex.props(s.rowText, s.rowTitle)}>{t('profile.links.statistics')}</span>
              <span aria-hidden="true" {...stylex.props(s.chevron)}>
                ›
              </span>
            </Link>
          </li>
          <li {...stylex.props(s.listItem)}>
            <Link to="/matches/past" {...stylex.props(s.row)}>
              <RowIcon d={ICONS.history} />
              <span {...stylex.props(s.rowText, s.rowTitle)}>
                {t('profile.links.matchHistory')}
              </span>
              <span aria-hidden="true" {...stylex.props(s.chevron)}>
                ›
              </span>
            </Link>
          </li>
          <li {...stylex.props(s.listItem)}>
            <Link
              to="/level-reviews/new"
              aria-labelledby={`${reviewId}-title`}
              aria-describedby={`${reviewId}-description`}
              {...stylex.props(s.row)}
            >
              <RowIcon d={ICONS.scale} />
              <span {...stylex.props(s.rowText)}>
                <span id={`${reviewId}-title`} {...stylex.props(s.rowTitle)}>
                  {t('levelReview.entry.request')}
                </span>
                <span id={`${reviewId}-description`} {...stylex.props(s.rowMeta)}>
                  {t('levelReview.entry.description')}
                </span>
              </span>
              <span aria-hidden="true" {...stylex.props(s.chevron)}>
                ›
              </span>
            </Link>
          </li>
          <li {...stylex.props(s.listItem)}>
            <Link to="/notifications" {...stylex.props(s.row)}>
              <RowIcon d={ICONS.bell} />
              <span {...stylex.props(s.rowText, s.rowTitle)}>
                {t('profile.links.notifications')}
              </span>
              <span aria-hidden="true" {...stylex.props(s.chevron)}>
                ›
              </span>
            </Link>
          </li>
          <li {...stylex.props(s.listItem)}>
            <Link to="/level-reviews" {...stylex.props(s.row)}>
              <RowIcon d={ICONS.history} />
              <span {...stylex.props(s.rowText, s.rowTitle)}>{t('levelReview.entry.history')}</span>
              <span aria-hidden="true" {...stylex.props(s.chevron)}>
                ›
              </span>
            </Link>
          </li>
        </ul>
      </nav>
      <SurfaceCard>
        <div {...stylex.props(s.fact)}>
          <span>{t('profile.dominantHand')}</span>
          <span>
            {profile.dominant_hand
              ? t(profile.dominant_hand === 'LEFT' ? 'profile.handLeft' : 'profile.handRight')
              : t('profile.handNone')}
          </span>
        </div>
        <div {...stylex.props(s.fact)}>
          <span>{t('profile.availabilityDaysLegend')}</span>
          <span {...stylex.props(ui.availabilitySummaryValue)}>
            {listChoices(profile.preferred_playing_days, 'profile.availabilityDays')}
          </span>
        </div>
        <div {...stylex.props(s.fact)}>
          <span>{t('profile.availabilityTimesLegend')}</span>
          <span {...stylex.props(ui.availabilitySummaryValue)}>
            {listChoices(profile.preferred_playing_times, 'profile.availabilityTimes')}
          </span>
        </div>
        {profile.bio && <p {...stylex.props(s.meta)}>{profile.bio}</p>}
      </SurfaceCard>
      <RatingJourney load={initialRating} onReload={onRatingReload} />
      <PlatformAdminEntry allowed={platformAdmin} />
      {signOutError && (
        <p role="alert" {...stylex.props(s.error)}>
          {t('profile.signOutFailed')}
        </p>
      )}
      <button
        type="button"
        onClick={() =>
          // Retire this device's Web Push registration while the session is still valid.
          void cleanupPushDeviceForLogout()
            .then(() => getBrowserClient().auth.signOut())
            .then(({ error: signOutFailure }) => {
              if (signOutFailure) setSignOutError(true);
              // Root is a public Google-facing landing page now; sign-out targets /login directly.
              else window.location.assign('/login');
            })
            .catch(() => setSignOutError(true))
        }
        {...stylex.props(s.actionButton)}
      >
        {t('signOut')}
      </button>
    </main>
  );
}
