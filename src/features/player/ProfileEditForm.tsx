import * as stylex from '@stylexjs/stylex';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { isOffline, isTransportFailure } from '../../lib/connectivity';
import { stripEdgeWhitespace } from '../../lib/edge-whitespace';
import { useAppPreferences, type AppTheme } from '../preferences/app-preferences';
import { AvailabilityFields } from './AvailabilityFields';
import { AvatarUpload } from './AvatarUpload';
import { getMyPlayerProfile, updateMyPlayerProfile } from './player.functions';
import { onboardingStyles as choiceStyles } from './player-onboarding.styles';
import { profileEdit as s } from './profile-edit.styles';
import { ui } from './player-ui.styles';

type Profile = Awaited<ReturnType<typeof updateMyPlayerProfile>>;

const SIDES = [
  ['LEFT', 'onboarding.sideLeft'],
  ['RIGHT', 'onboarding.sideRight'],
  ['EITHER', 'onboarding.sideEither']
] as const;

/**
 * Profile edit screen (frames VpcMM / xlgw8): the same fields, validation and save as before,
 * on the Clubhouse form layout. Theme and language are staged here and applied through the root
 * handlers only after the profile saved, so Cancel leaves every preference untouched.
 */
export function ProfileEditForm({
  profile,
  onProfileChange,
  onSaved,
  onCancel
}: {
  profile: Profile;
  /** The authoritative profile changed outside the draft (avatar upload, unconfirmed save). */
  onProfileChange: (profile: Profile) => void;
  onSaved: (profile: Profile) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const preferences = useAppPreferences();
  const [name, setName] = useState(profile.display_name);
  const [side, setSide] = useState(profile.preferred_side);
  const [hand, setHand] = useState(profile.dominant_hand ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [days, setDays] = useState(profile.preferred_playing_days);
  const [times, setTimes] = useState(profile.preferred_playing_times);
  const [theme, setTheme] = useState<AppTheme | null>(null);
  const [locale, setLocale] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const nameInvalid =
    !stripEdgeWhitespace(name) || Array.from(stripEdgeWhitespace(name)).length > 80;
  const chosenTheme = theme ?? preferences?.theme ?? 'light';
  const chosenLocale = locale ?? preferences?.locale ?? 'en';

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = stripEdgeWhitespace(name);
    if (nameInvalid) {
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
      if (preferences) {
        if (theme && theme !== preferences.theme) preferences.changeTheme(theme);
        if (locale && locale !== preferences.locale) await preferences.changeLocale(locale);
      }
      onSaved(next);
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
        onProfileChange(await getMyPlayerProfile());
      } catch {
        // Stay unconfirmed; the retry stays available.
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main data-route-chrome="navigation" data-app-chrome="hidden" {...stylex.props(s.page)}>
      <header {...stylex.props(s.topBar)}>
        <button
          type="button"
          onClick={onCancel}
          aria-label={t('profile.backToProfile')}
          {...stylex.props(s.back)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...stylex.props(s.backIcon)}
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <p {...stylex.props(s.navTitle)}>{t('profile.navTitle')}</p>
      </header>
      <form onSubmit={(event) => void save(event)} noValidate {...stylex.props(s.form)}>
        <div {...stylex.props(s.content)}>
          <h1 {...stylex.props(s.title)}>{t('profile.edit')}</h1>
          <AvatarUpload
            name={profile.display_name}
            avatarUrl={profile.avatar_signed_url}
            onUploaded={onProfileChange}
          />
          <TextField
            id="edit-name"
            ref={nameRef}
            label={t('onboarding.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            aria-invalid={Boolean(error && nameInvalid)}
          />
          <section {...stylex.props(s.group)}>
            <h2 {...stylex.props(s.groupTitle)}>{t('profile.availability')}</h2>
            <AvailabilityFields
              days={days}
              times={times}
              onDaysChange={setDays}
              onTimesChange={setTimes}
              disabled={saving}
              pills
            />
          </section>
          {preferences && (
            <section {...stylex.props(s.group)}>
              <h2 {...stylex.props(s.groupTitle)}>{t('profile.preferences')}</h2>
              <fieldset {...stylex.props(s.subgroup)}>
                <legend {...stylex.props(s.legend)}>{t('theme')}</legend>
                <div {...stylex.props(choiceStyles.choices)}>
                  {(['light', 'dark'] as const).map((value) => (
                    <label
                      key={value}
                      {...stylex.props(
                        choiceStyles.choice,
                        chosenTheme === value && choiceStyles.chosen
                      )}
                    >
                      <input
                        type="radio"
                        name="edit-theme"
                        checked={chosenTheme === value}
                        onChange={() => setTheme(value)}
                        {...stylex.props(ui.radio)}
                      />
                      {t(value)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div {...stylex.props(s.subgroup)}>
                <label htmlFor="edit-language" {...stylex.props(s.label)}>
                  {t('language')}
                </label>
                <select
                  id="edit-language"
                  value={chosenLocale}
                  onChange={(event) => setLocale(event.target.value)}
                  {...stylex.props(s.select)}
                >
                  <option value="en">{t('languageNames.en')}</option>
                  <option value="pt-BR">{t('languageNames.pt-BR')}</option>
                  <option value="es">{t('languageNames.es')}</option>
                </select>
              </div>
            </section>
          )}
          {/* Not drawn in the frames; kept so the saved profile fields are unchanged. */}
          <fieldset {...stylex.props(s.subgroup)}>
            <legend {...stylex.props(s.legend)}>{t('onboarding.side')}</legend>
            <div {...stylex.props(choiceStyles.choices)}>
              {SIDES.map(([value, key]) => (
                <label
                  key={value}
                  {...stylex.props(choiceStyles.choice, side === value && choiceStyles.chosen)}
                >
                  <input
                    type="radio"
                    name="edit-side"
                    checked={side === value}
                    onChange={() => setSide(value)}
                    {...stylex.props(ui.radio)}
                  />
                  {t(key)}
                </label>
              ))}
            </div>
          </fieldset>
          <div {...stylex.props(s.subgroup)}>
            <label htmlFor="edit-hand" {...stylex.props(s.label)}>
              {t('profile.dominantHand')}
            </label>
            <select
              id="edit-hand"
              value={hand}
              onChange={(event) => setHand(event.target.value)}
              {...stylex.props(s.select)}
            >
              <option value="">{t('profile.handNone')}</option>
              <option value="LEFT">{t('profile.handLeft')}</option>
              <option value="RIGHT">{t('profile.handRight')}</option>
            </select>
          </div>
          <div {...stylex.props(s.subgroup)}>
            <label htmlFor="edit-bio" {...stylex.props(s.label)}>
              {t('profile.bio')}
            </label>
            <textarea
              id="edit-bio"
              value={bio}
              maxLength={280}
              onChange={(event) => setBio(event.target.value)}
              {...stylex.props(s.select, s.textarea)}
            />
          </div>
          {error && (
            <p role="alert" {...stylex.props(s.fieldError)}>
              {t(error)}
            </p>
          )}
        </div>
        <div {...stylex.props(s.actions)}>
          <Button variant="secondary" onClick={onCancel} xstyle={s.cancel}>
            {t('profile.cancel')}
          </Button>
          <Button type="submit" disabled={saving} xstyle={s.save}>
            {saving ? t('onboarding.saving') : t('profile.save')}
          </Button>
        </div>
      </form>
    </main>
  );
}
