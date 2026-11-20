import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isOffline, isTransportFailure } from '../../lib/connectivity';
import { stripEdgeWhitespace } from '../../lib/edge-whitespace';
import { getBrowserClient } from '../../lib/supabase/client';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { PlatformAdminEntry } from '../level-reviews/PlatformAdminEntry';
import { cleanupPushDeviceForLogout } from '../notifications/push-browser';
import { AvailabilityFields } from './AvailabilityFields';
import { AvatarUpload } from './AvatarUpload';
import { getMyPlayerProfile, updateMyPlayerProfile } from './player.functions';
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

export function PlayerProfile({
  initialProfile,
  initialRating,
  onRatingReload,
  platformAdmin = false
}: {
  initialProfile: Profile;
  initialRating: RatingLoad;
  onRatingReload: () => void;
  /** Server-reported platform-admin access (`get_level_review_access`), never a client guess. */
  platformAdmin?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState(initialProfile);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.display_name);
  const [side, setSide] = useState(profile.preferred_side);
  const [hand, setHand] = useState(profile.dominant_hand ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [days, setDays] = useState(profile.preferred_playing_days);
  const [times, setTimes] = useState(profile.preferred_playing_times);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [signOutError, setSignOutError] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = stripEdgeWhitespace(name);
    if (!normalizedName || Array.from(normalizedName).length > 80) {
      setError('onboarding.validationName');
      nameRef.current?.focus();
      return;
    }
    if (isOffline()) {
      setError('profile.saveOffline');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const next = await updateMyPlayerProfile({
        data: {
          display_name: normalizedName,
          preferred_side: side,
          dominant_hand: hand || null,
          bio: bio.trim() || null,
          preferred_playing_days: days,
          preferred_playing_times: times
        }
      });
      setProfile(next);
      setName(next.display_name);
      setSide(next.preferred_side);
      setHand(next.dominant_hand ?? '');
      setBio(next.bio ?? '');
      setDays(next.preferred_playing_days);
      setTimes(next.preferred_playing_times);
      setEditing(false);
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'UNAUTHENTICATED') {
        window.location.assign('/login?next=/dashboard');
        return;
      }
      if (!isTransportFailure(cause)) {
        setError('profile.saveFailed');
        return;
      }
      // Outcome unknown: re-read the authoritative profile before any retry, keeping the draft.
      setError('profile.saveUnconfirmed');
      try {
        setProfile(await getMyPlayerProfile());
      } catch {
        // Stay unconfirmed; the retry stays available.
      }
    } finally {
      setSaving(false);
    }
  }

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
          onClick={() => setEditing(!editing)}
          aria-label={t('profile.edit')}
          aria-pressed={editing}
          {...stylex.props(s.editButton, editing && s.editButtonOn)}
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
        </ul>
      </nav>
      <section aria-label={t('levelReview.entry.title')}>
        <ul {...stylex.props(s.list)}>
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
            <Link to="/level-reviews" {...stylex.props(s.row)}>
              <RowIcon d={ICONS.history} />
              <span {...stylex.props(s.rowText, s.rowTitle)}>{t('levelReview.entry.history')}</span>
              <span aria-hidden="true" {...stylex.props(s.chevron)}>
                ›
              </span>
            </Link>
          </li>
        </ul>
      </section>
      {editing ? (
        <form
          onSubmit={(event) => void save(event)}
          noValidate
          {...stylex.props(ui.card, ui.profileCard)}
        >
          <label htmlFor="edit-name" {...stylex.props(ui.label)}>
            {t('onboarding.name')}
          </label>
          <input
            id="edit-name"
            ref={nameRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            aria-invalid={Boolean(
              error &&
              (!stripEdgeWhitespace(name) || Array.from(stripEdgeWhitespace(name)).length > 80)
            )}
            {...stylex.props(ui.input)}
          />
          <fieldset {...stylex.props(ui.fieldset)}>
            <legend {...stylex.props(ui.label)}>{t('onboarding.side')}</legend>
            <div {...stylex.props(ui.choices)}>
              {(['LEFT', 'RIGHT', 'EITHER'] as const).map((value) => (
                <label key={value} {...stylex.props(ui.choice, side === value && ui.selected)}>
                  <input
                    type="radio"
                    name="edit-side"
                    checked={side === value}
                    onChange={() => setSide(value)}
                    {...stylex.props(ui.radio)}
                  />
                  {t(
                    value === 'LEFT'
                      ? 'onboarding.sideLeft'
                      : value === 'RIGHT'
                        ? 'onboarding.sideRight'
                        : 'onboarding.sideEither'
                  )}
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor="edit-hand" {...stylex.props(ui.label)}>
            {t('profile.dominantHand')}
          </label>
          <select
            id="edit-hand"
            value={hand}
            onChange={(event) => setHand(event.target.value)}
            {...stylex.props(ui.input)}
          >
            <option value="">{t('profile.handNone')}</option>
            <option value="LEFT">{t('profile.handLeft')}</option>
            <option value="RIGHT">{t('profile.handRight')}</option>
          </select>
          <label htmlFor="edit-bio" {...stylex.props(ui.label)}>
            {t('profile.bio')}
          </label>
          <textarea
            id="edit-bio"
            value={bio}
            maxLength={280}
            onChange={(event) => setBio(event.target.value)}
            {...stylex.props(ui.input, ui.textarea)}
          />
          <AvailabilityFields
            days={days}
            times={times}
            onDaysChange={setDays}
            onTimesChange={setTimes}
            disabled={saving}
          />
          {error && (
            <p role="alert" {...stylex.props(ui.error)}>
              {t(error)}
            </p>
          )}
          <button type="submit" disabled={saving} {...stylex.props(ui.button)}>
            {saving ? t('onboarding.saving') : t('profile.save')}
          </button>
        </form>
      ) : (
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
      )}
      <SurfaceCard>
        <AvatarUpload
          name={profile.display_name}
          avatarUrl={profile.avatar_signed_url}
          onUploaded={setProfile}
        />
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
