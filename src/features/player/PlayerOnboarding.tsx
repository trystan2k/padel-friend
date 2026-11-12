import * as stylex from '@stylexjs/stylex';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { HeroCard } from '../../components/ui/HeroCard';
import { StepBadge } from '../../components/ui/StepBadge';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { TextField } from '../../components/ui/TextField';
import { stripEdgeWhitespace } from '../../lib/edge-whitespace';
import { ClaimPasswordStep } from './ClaimPasswordStep';
import { AvailabilityFields } from './AvailabilityFields';
import { OnboardingAvatar } from './OnboardingAvatar';
import { uploadOwnerAvatar } from './avatar-upload';
import {
  claimProvisionalPlayer,
  completeAvatarUpload,
  getMyPlayerProfile,
  getPasswordSetupState,
  onboardPlayer
} from './player.functions';
import type { PlayingDay, PlayingTime } from './player-availability';
import { INITIAL_RELIABILITY_PERCENT, LEVEL_STEP, MAX_LEVEL, MIN_LEVEL } from './rating-config';
import {
  validateInitialLevel,
  type OnboardPlayerInput,
  type PreferredSide
} from './player.validators';
import type { ProvisionalClaim } from './provisional-claim';
import { ui } from './player-ui.styles';
import { normalizeReturnPath, optionalReturnPath } from '../auth/return-path';

const NAME_MAX_CODE_POINTS = 80;

type ReadyClaim = Extract<ProvisionalClaim, { state: 'ready' }>;

/**
 * Profile setup for a new account, or the verified claim of a provisional
 * identity (`claim`): same form, prefilled from the creator's data, with the
 * starting level locked once rated history exists.
 */
export function PlayerOnboarding({
  next: returnPath,
  claim
}: {
  next?: string;
  claim?: ReadyClaim;
}) {
  const { t, i18n } = useTranslation();
  const nameRef = useRef<HTMLInputElement>(null);
  const sideRef = useRef<HTMLInputElement>(null);
  const levelRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(claim?.displayName ?? '');
  const [side, setSide] = useState<PreferredSide | null>(null);
  const [level, setLevel] = useState(claim ? claim.initialLevel.toFixed(1) : '3.0');
  const levelLocked = claim ? !claim.canEditLevel : false;
  const [hand, setHand] = useState<'LEFT' | 'RIGHT' | null>(null);
  const [bio, setBio] = useState('');
  const [days, setDays] = useState<PlayingDay[] | null>(null);
  const [times, setTimes] = useState<PlayingTime[] | null>(null);
  const [errors, setErrors] = useState<Partial<Record<'name' | 'side' | 'level', string>>>({});
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [committed, setCommitted] = useState(false);
  // The profile (or claim) is committed exactly once; later photo retries never resubmit it.
  const committedRef = useRef(false);
  // Storage key of the uploaded photo, kept so a finalize retry does not upload a duplicate.
  const photoKeyRef = useRef<string | null>(null);
  const navigatingRef = useRef(false);
  const [passwordStep, setPasswordStep] = useState<{ canSkip: boolean } | null>(null);
  // Inputs freeze while saving and once the profile is committed (only the photo can still change).
  const locked = saving || committed;
  const selectedLevel = Number(level);
  const sliderLevel = Number.isFinite(selectedLevel)
    ? Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, selectedLevel))
    : MIN_LEVEL;
  const formatLevel = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value);

  // Validation counts code points; an HTML maxLength counts UTF-16 units, so the limit is checked here.
  function changeName(value: string) {
    setName(value);
    setErrors((current) => ({
      ...current,
      name:
        Array.from(stripEdgeWhitespace(value)).length > NAME_MAX_CODE_POINTS
          ? 'onboarding.validationName'
          : undefined
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || committedRef.current) return;
    const nextErrors: typeof errors = {};
    const normalizedName = stripEdgeWhitespace(name);
    if (!normalizedName || Array.from(normalizedName).length > NAME_MAX_CODE_POINTS)
      nextErrors.name = 'onboarding.validationName';
    if (!side) nextErrors.side = 'onboarding.validationSide';
    let initialLevel: number | undefined;
    try {
      initialLevel = validateInitialLevel(level);
    } catch {
      nextErrors.level = 'onboarding.validationLevel';
    }
    setErrors(nextErrors);
    if (nextErrors.name) nameRef.current?.focus();
    else if (nextErrors.side) sideRef.current?.focus();
    else if (nextErrors.level) levelRef.current?.focus();
    if (Object.keys(nextErrors).length || !side || initialLevel === undefined) return;
    const profile = {
      display_name: normalizedName,
      preferred_side: side,
      initial_level: initialLevel,
      dominant_hand: hand,
      bio: bio.trim() || null,
      preferred_playing_days: days,
      preferred_playing_times: times
    };
    await complete({ profile, withPhoto: true });
  }

  function navigate(target: string) {
    navigatingRef.current = true;
    window.location.assign(target);
  }

  // Original success continuation, shared by the normal submit, a photo retry and the
  // "continue without photo" recovery so all three behave identically.
  async function continueAfterProfile() {
    if (claim) {
      // The claim reset the password, so ask for a new one before leaving. The server says
      // whether one is owed and whether a verified provider identity lets the claimant skip
      // it. `saving` stays set until the lookup is done, so the form cannot be resubmitted
      // in between. If the lookup fails the step is shown without a skip (fail closed).
      const state = await getPasswordSetupState().catch(() => ({
        pending: true,
        canSkip: false
      }));
      if (state.pending || state.canSkip) {
        setPasswordStep({ canSkip: state.canSkip });
        return;
      }
      navigate(normalizeReturnPath(returnPath));
      return;
    }
    const search = new URLSearchParams(optionalReturnPath(returnPath)).toString();
    navigate(`/onboarding/community${search ? `?${search}` : ''}`);
  }

  // Uploads (once) and finalizes the chosen photo. Returns false on a recoverable failure.
  async function savePhoto(file: File): Promise<boolean> {
    try {
      if (photoKeyRef.current) {
        // A previous finalize may have succeeded without a response: trust the authoritative
        // profile instead of overwriting whatever avatar it already has.
        const current = await getMyPlayerProfile();
        if (current.avatar_signed_url) return true;
      }
      photoKeyRef.current ??= await uploadOwnerAvatar(file);
      await completeAvatarUpload({ data: { objectKey: photoKeyRef.current } });
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === 'UNAUTHENTICATED') throw error;
      return false;
    }
  }

  async function complete({
    profile,
    withPhoto
  }: {
    profile?: OnboardPlayerInput;
    withPhoto: boolean;
  }) {
    setSaving(true);
    setFailed(false);
    setPhotoFailed(false);
    try {
      if (profile && !committedRef.current) {
        if (claim) await claimProvisionalPlayer({ data: profile });
        else await onboardPlayer({ data: profile });
        committedRef.current = true;
        setCommitted(true);
      }
      if (withPhoto && photo && !(await savePhoto(photo))) {
        setPhotoFailed(true);
        return;
      }
      await continueAfterProfile();
    } catch (error) {
      if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
        navigate('/login?next=/onboarding');
        return;
      }
      if (claim && error instanceof Error && error.message === 'PLAYER_CLAIM_NOT_PENDING') {
        // Already claimed (double submit or another tab): continue to the destination.
        navigate(normalizeReturnPath(returnPath));
        return;
      }
      if (claim && error instanceof Error && error.message === 'PLAYER_CLAIM_NOT_VERIFIED') {
        // Mailbox proof is gone or never existed: the loader shows the verification step.
        navigatingRef.current = true;
        window.location.reload();
        return;
      }
      setFailed(true);
    } finally {
      if (!navigatingRef.current) setSaving(false);
    }
  }

  if (passwordStep) return <ClaimPasswordStep canSkip={passwordStep.canSkip} next={returnPath} />;

  return (
    <main {...stylex.props(ui.page, ui.onboardingPage)}>
      <div {...stylex.props(ui.topContent)}>
        {claim && claim.matchCount > 0 && (
          <div {...stylex.props(ui.claimNotice)}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
              data-testid="claim-notice-icon"
              {...stylex.props(ui.claimNoticeIcon)}
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5M12 8h.01" />
            </svg>
            <p {...stylex.props(ui.claimNoticeText)}>
              {t('auth.claim.invitedNotice', { count: claim.matchCount })}
            </p>
          </div>
        )}
        <StepBadge>{t(claim ? 'auth.claim.step' : 'onboarding.step')}</StepBadge>
        <header {...stylex.props(ui.header)}>
          <h1 {...stylex.props(ui.title)}>{t(claim ? 'auth.claim.title' : 'onboarding.title')}</h1>
          <p {...stylex.props(ui.subtitle)}>
            {t(claim ? 'auth.claim.subtitle' : 'onboarding.subtitle')}
          </p>
        </header>
      </div>
      <HeroCard>
        <h2 {...stylex.props(ui.heroTitle)}>{t('onboarding.levelHelp')}</h2>
        <p {...stylex.props(ui.heroCopy)}>
          {t(claim && !levelLocked ? 'auth.claim.levelNote' : 'onboarding.scaleDescription')}
        </p>
      </HeroCard>
      <form
        onSubmit={(event) => void submit(event)}
        noValidate
        {...stylex.props(ui.stack, ui.onboardingForm)}
      >
        <TextField
          id="player-name"
          name="display-name"
          label={t('onboarding.name')}
          ref={nameRef}
          value={name}
          onChange={(event) => changeName(event.target.value)}
          required
          disabled={locked}
          error={errors.name ? t(errors.name) : undefined}
        />
        <OnboardingAvatar name={name} file={photo} onFileChange={setPhoto} disabled={locked} />
        <SurfaceCard xstyle={ui.onboardingCard}>
          <div {...stylex.props(ui.onboardingLevelHeading)}>
            <span {...stylex.props(ui.label)}>{t('onboarding.level')}</span>
            <output htmlFor="player-level" {...stylex.props(ui.level, ui.onboardingLevelValue)}>
              {level && Number.isFinite(selectedLevel)
                ? formatLevel(selectedLevel)
                : t('onboarding.validationLevel')}
            </output>
          </div>
          <div {...stylex.props(ui.sliderGroup)}>
            <div {...stylex.props(ui.sliderTrack)}>
              <div
                {...stylex.props(ui.sliderFill)}
                style={{ width: `${(sliderLevel / MAX_LEVEL) * 100}%` }}
              />
              <input
                type="range"
                min={MIN_LEVEL}
                max={MAX_LEVEL}
                step={LEVEL_STEP}
                value={sliderLevel}
                onChange={(event) => setLevel(Number(event.target.value).toFixed(1))}
                disabled={levelLocked || locked}
                aria-label={t('onboarding.levelScale')}
                aria-describedby={
                  levelLocked
                    ? 'level-range-description claim-level-locked'
                    : 'level-range-description'
                }
                {...stylex.props(ui.sliderInput)}
              />
            </div>
            <div id="level-range-description" {...stylex.props(ui.sliderLabels)}>
              <span>{formatLevel(MIN_LEVEL)}</span>
              <span
                {...stylex.props(ui.sliderCurrent)}
                style={{
                  left: `clamp(var(--space-12), ${(sliderLevel / MAX_LEVEL) * 100}%, calc(100% - var(--space-12)))`
                }}
              >
                {formatLevel(sliderLevel)}
              </span>
              <span>{formatLevel(MAX_LEVEL)}</span>
            </div>
          </div>
          <div {...stylex.props(ui.scaleCaption, ui.onboardingScaleCaption)}>
            <span>{t('onboarding.beginner')}</span>
            <span>{t('onboarding.advanced')}</span>
          </div>
          {levelLocked && (
            <p id="claim-level-locked" {...stylex.props(ui.muted)}>
              {t('auth.claim.levelLocked')}
            </p>
          )}
        </SurfaceCard>
        <SurfaceCard xstyle={ui.onboardingCard}>
          <div {...stylex.props(ui.onboardingChoiceStack)}>
            <fieldset
              aria-invalid={Boolean(errors.side)}
              aria-describedby={errors.side ? 'player-side-error' : undefined}
              {...stylex.props(ui.fieldset, ui.bareFieldset, ui.choiceSection)}
            >
              <legend {...stylex.props(ui.srOnly)}>{t('onboarding.side')}</legend>
              <span aria-hidden="true" {...stylex.props(ui.label, ui.choiceLabel)}>
                {t('onboarding.side')}
              </span>
              <div {...stylex.props(ui.choices, ui.onboardingChoices)}>
                {(['LEFT', 'RIGHT', 'EITHER'] as const).map((value, index) => (
                  <label key={value} {...stylex.props(ui.choice, side === value && ui.selected)}>
                    <input
                      ref={index === 0 ? sideRef : undefined}
                      type="radio"
                      name="side"
                      value={value}
                      checked={side === value}
                      disabled={locked}
                      onChange={() => setSide(value)}
                      aria-describedby={errors.side ? 'player-side-error' : undefined}
                      {...stylex.props(ui.radio)}
                    />
                    {t(
                      value === 'LEFT'
                        ? 'onboarding.sideLeftShort'
                        : value === 'RIGHT'
                          ? 'onboarding.sideRightShort'
                          : 'onboarding.sideEitherShort'
                    )}
                  </label>
                ))}
              </div>
              {errors.side && (
                <p id="player-side-error" role="alert" {...stylex.props(ui.error)}>
                  {t(errors.side)}
                </p>
              )}
            </fieldset>
            <fieldset {...stylex.props(ui.fieldset, ui.bareFieldset, ui.handSection)}>
              <legend {...stylex.props(ui.srOnly)}>{t('profile.dominantHand')}</legend>
              <span aria-hidden="true" {...stylex.props(ui.label, ui.choiceLabel)}>
                {t('profile.dominantHand')}
              </span>
              <div id="player-hand-options" {...stylex.props(ui.handChoices)}>
                {[
                  { value: 'LEFT' as const, label: t('onboarding.handLeft') },
                  { value: 'RIGHT' as const, label: t('onboarding.handRight') },
                  { value: null, label: t('onboarding.handPreferNot') }
                ].map(({ value, label }) => (
                  <label
                    key={value ?? 'prefer-not'}
                    {...stylex.props(ui.handChoice, hand === value && ui.selected)}
                  >
                    <input
                      type="radio"
                      name="dominant_hand"
                      value={value ?? ''}
                      checked={hand === value}
                      disabled={locked}
                      onChange={() => setHand(value)}
                      {...stylex.props(ui.radio)}
                    />
                    <span
                      {...stylex.props(
                        ui.handChoiceText,
                        value === null && ui.handChoiceTextCompact
                      )}
                    >
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </SurfaceCard>
        <SurfaceCard xstyle={ui.onboardingCard}>
          <StepBadge>
            {t('onboarding.reliabilityLabel', { value: INITIAL_RELIABILITY_PERCENT })}
          </StepBadge>
          <p {...stylex.props(ui.muted)}>{t('onboarding.reliabilityHelp')}</p>
        </SurfaceCard>
        {failed && (
          <p role="alert" {...stylex.props(ui.error)}>
            {t(claim ? 'auth.claim.failed' : 'onboarding.failed')}
          </p>
        )}
        {photoFailed ? (
          <div {...stylex.props(ui.stack)}>
            <p role="alert" {...stylex.props(ui.error)}>
              {t('onboarding.avatarFailed')}
            </p>
            <Button busy={saving} onClick={() => void complete({ withPhoto: true })}>
              {t('onboarding.avatarRetry')}
            </Button>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => void complete({ withPhoto: false })}
            >
              {t('onboarding.avatarContinue')}
            </Button>
          </div>
        ) : (
          <Button type="submit" busy={saving}>
            {saving ? (
              t('onboarding.saving')
            ) : (
              <>
                {t(claim ? 'auth.claim.submit' : 'onboarding.save')}{' '}
                <span aria-hidden="true">→</span>
              </>
            )}
          </Button>
        )}
        <SurfaceCard xstyle={ui.onboardingExtras}>
          <label htmlFor="player-level" {...stylex.props(ui.label)}>
            {t('onboarding.preciseLevel')}
          </label>
          <input
            id="player-level"
            ref={levelRef}
            type="number"
            inputMode="decimal"
            min={MIN_LEVEL}
            max={MAX_LEVEL}
            step={LEVEL_STEP}
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            required
            disabled={levelLocked || locked}
            aria-invalid={Boolean(errors.level)}
            aria-describedby={errors.level ? 'player-level-error' : undefined}
            {...stylex.props(ui.input)}
          />
          {errors.level && (
            <p id="player-level-error" role="alert" {...stylex.props(ui.error)}>
              {t(errors.level)}
            </p>
          )}
        </SurfaceCard>
        <SurfaceCard>
          <label htmlFor="onboard-bio" {...stylex.props(ui.label)}>
            {t('profile.bio')}
          </label>
          <textarea
            id="onboard-bio"
            maxLength={280}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            disabled={locked}
            {...stylex.props(ui.input, ui.textarea)}
          />
        </SurfaceCard>
        <SurfaceCard>
          <h2 {...stylex.props(ui.label)}>{t('profile.availability')}</h2>
          <AvailabilityFields
            days={days}
            times={times}
            onDaysChange={setDays}
            onTimesChange={setTimes}
            disabled={locked}
          />
        </SurfaceCard>
      </form>
    </main>
  );
}
