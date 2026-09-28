import * as stylex from '@stylexjs/stylex';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getBrowserClient } from '../../lib/supabase/client';
import { AvatarUpload } from './AvatarUpload';
import { updateMyPlayerProfile } from './player.functions';
import { playerInitials } from './player-initials';
import { formatDisplayLevel } from './rating-config';
import { ui } from './player-ui.styles';

type Profile = Awaited<ReturnType<typeof updateMyPlayerProfile>>;

export function PlayerProfile({ initialProfile }: { initialProfile: Profile }) {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState(initialProfile);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.display_name);
  const [side, setSide] = useState(profile.preferred_side);
  const [hand, setHand] = useState(profile.dominant_hand ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [signOutError, setSignOutError] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const joined = new Intl.DateTimeFormat(i18n.language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(profile.joined_at));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || Array.from(name.trim()).length > 80) {
      setError('onboarding.validationName');
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const next = await updateMyPlayerProfile({
        data: {
          display_name: name,
          preferred_side: side,
          dominant_hand: hand || null,
          bio: bio.trim() || null
        }
      });
      setProfile(next);
      setEditing(false);
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'UNAUTHENTICATED') {
        window.location.assign('/login?next=/dashboard');
        return;
      }
      setError('profile.saveFailed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main {...stylex.props(ui.page, ui.profilePage)}>
      <div {...stylex.props(ui.profileTop)}>
        <header {...stylex.props(ui.headerRow)}>
          <div {...stylex.props(ui.header)}>
            <h1 {...stylex.props(ui.title)}>{t('profile.title')}</h1>
            <p {...stylex.props(ui.subtitle)}>{t('profile.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => setEditing(!editing)}
            aria-label={t('profile.edit')}
            aria-pressed={editing}
            {...stylex.props(ui.button, ui.headerAction)}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              {...stylex.props(ui.headerActionIcon)}
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.9l.06.06-1.9 1.9-.06-.06a1.7 1.7 0 0 0-1.9-.34 1.7 1.7 0 0 0-1 1.55V21h-2.7v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.9.34l-.06.06-1.9-1.9.06-.06A1.7 1.7 0 0 0 7.8 15a1.7 1.7 0 0 0-1.55-1H6v-2.7h.25a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.9L7.4 8.34l1.9-1.9.06.06a1.7 1.7 0 0 0 1.9.34 1.7 1.7 0 0 0 1-1.55V5h2.7v.29a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.9-.34l.06-.06 1.9 1.9-.06.06a1.7 1.7 0 0 0-.34 1.9 1.7 1.7 0 0 0 1.55 1H21V14h-.03a1.7 1.7 0 0 0-1.57 1Z" />
            </svg>
          </button>
        </header>
        <section {...stylex.props(ui.hero, ui.identityHero)}>
          <div {...stylex.props(ui.identity)}>
            {profile.avatar_signed_url ? (
              <img
                src={profile.avatar_signed_url}
                alt={t('profile.avatarAlt', { name: profile.display_name })}
                {...stylex.props(ui.avatar)}
              />
            ) : (
              <span aria-hidden="true" {...stylex.props(ui.avatar)}>
                {playerInitials(profile.display_name)}
              </span>
            )}
            <div>
              <h2 {...stylex.props(ui.name)}>{profile.display_name}</h2>
              <p {...stylex.props(ui.heroCopy, ui.heroSide)}>
                {t(
                  profile.preferred_side === 'LEFT'
                    ? 'onboarding.sideLeft'
                    : profile.preferred_side === 'RIGHT'
                      ? 'onboarding.sideRight'
                      : 'onboarding.sideEither'
                )}
              </p>
              <p {...stylex.props(ui.heroCopy, ui.heroJoined)}>
                {t('profile.joinedOn', { date: joined })}
              </p>
            </div>
          </div>
        </section>
      </div>
      <section {...stylex.props(ui.card, ui.profileCard)}>
        <div {...stylex.props(ui.levelTop)}>
          <div {...stylex.props(ui.levelHeader)}>
            <span {...stylex.props(ui.levelLabel)}>{t('profile.globalLevel')}</span>
            <strong {...stylex.props(ui.levelMetric)}>
              {formatDisplayLevel(profile.display_level, i18n.language)}
            </strong>
          </div>
          <strong {...stylex.props(ui.step)}>
            {t('profile.reliability')}:{' '}
            {t('profile.percent', { value: profile.reliability_percent })}
          </strong>
        </div>
        <progress
          aria-label={t('profile.levelScale')}
          max={7}
          value={profile.display_level}
          {...stylex.props(ui.srOnly)}
        />
        <div aria-hidden="true" {...stylex.props(ui.progressTrack)}>
          <div
            {...stylex.props(ui.progressFill)}
            style={{ width: `${(profile.display_level / 7) * 100}%` }}
          />
        </div>
        <div {...stylex.props(ui.scaleCaption)}>
          <span {...stylex.props(ui.scaleEndpoint)}>{formatDisplayLevel(0, i18n.language)}</span>
          <span>{t('profile.levelScale')}</span>
          <span {...stylex.props(ui.scaleEndpoint)}>{formatDisplayLevel(7, i18n.language)}</span>
        </div>
        <div {...stylex.props(ui.row)}>
          <span>{t('profile.initialLevel')}</span>
          <strong>{formatDisplayLevel(profile.initial_display_level, i18n.language)}</strong>
        </div>
        <div {...stylex.props(ui.row)}>
          <span>{t('profile.highestLevel')}</span>
          <strong>{formatDisplayLevel(profile.highest_display_level, i18n.language)}</strong>
        </div>
        <div {...stylex.props(ui.row)}>
          <span>{t('profile.confirmedGroups')}</span>
          <strong>{profile.confirmed_competitive_game_groups}</strong>
        </div>
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
            aria-invalid={Boolean(error && (!name.trim() || Array.from(name.trim()).length > 80))}
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
        <section {...stylex.props(ui.card, ui.profileCard)}>
          <div {...stylex.props(ui.row)}>
            <span>{t('profile.dominantHand')}</span>
            <span>
              {profile.dominant_hand
                ? t(profile.dominant_hand === 'LEFT' ? 'profile.handLeft' : 'profile.handRight')
                : t('profile.handNone')}
            </span>
          </div>
          {profile.bio && <p>{profile.bio}</p>}
        </section>
      )}
      <section {...stylex.props(ui.card, ui.profileCard)}>
        <AvatarUpload
          name={profile.display_name}
          avatarUrl={profile.avatar_signed_url}
          onUploaded={setProfile}
        />
      </section>
      <section {...stylex.props(ui.card, ui.profileCard)}>
        <p {...stylex.props(ui.muted)}>{t('profile.historyEmpty')}</p>
      </section>
      {signOutError && (
        <p role="alert" {...stylex.props(ui.error)}>
          {t('profile.signOutFailed')}
        </p>
      )}
      <button
        type="button"
        onClick={() =>
          void getBrowserClient()
            .auth.signOut()
            .then(({ error: signOutFailure }) => {
              if (signOutFailure) setSignOutError(true);
              else window.location.assign('/');
            })
            .catch(() => setSignOutError(true))
        }
        {...stylex.props(ui.button, ui.secondaryButton)}
      >
        {t('signOut')}
      </button>
    </main>
  );
}
