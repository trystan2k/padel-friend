import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { AuthActionBar, AuthTopBar } from '../auth/AuthChrome';
import { chromeStyles as chrome } from '../auth/auth-chrome.styles';
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
  onboardPlayer,
  reconcileAvatarUpload
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
import { onboardingStyles as styles } from './player-onboarding.styles';
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
  // `conflict`: a different avatar is already stored (another session); never overwritten.
  const [photoIssue, setPhotoIssue] = useState<'failed' | 'conflict' | null>(null);
  const [committed, setCommitted] = useState(false);
  // The profile (or claim) is committed exactly once; later photo retries never resubmit it.
  const committedRef = useRef(false);
  // Storage key of the uploaded photo, kept so a finalize retry does not upload a duplicate.
  const photoKeyRef = useRef<string | null>(null);
  const navigatingRef = useRef(false);
  const conflictContinueRef = useRef<HTMLButtonElement>(null);
  const [passwordStep, setPasswordStep] = useState<{ canSkip: boolean } | null>(null);
  // Inputs freeze while saving and once the profile is committed (only the photo can still change).
  const locked = saving || committed;
  // The conflict state replaces the focused retry/submit button; hand focus to its primary action.
  useEffect(() => {
    if (photoIssue === 'conflict') conflictContinueRef.current?.focus();
  }, [photoIssue]);
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

  // Success continuation shared by every outcome (normal submit, already-committed profile,
  // photo retry, continue with/without photo) so all behave identically.
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

  // Uploads (once) and finalizes the chosen photo. Reports a recoverable failure or a
  // competing avatar instead of throwing.
  async function savePhoto(file: File): Promise<'saved' | 'failed' | 'conflict'> {
    try {
      if (photoKeyRef.current) {
        // A previous finalize may have succeeded without a response: the server compares this
        // upload's key with the stored one so a different concurrent avatar is never overwritten.
        const verdict = await reconcileAvatarUpload({ data: { objectKey: photoKeyRef.current } });
        if (verdict === 'same') return 'saved';
        if (verdict === 'conflict') return 'conflict';
      }
      photoKeyRef.current ??= await uploadOwnerAvatar(file);
      // Onboarding expects no stored avatar; the server enforces that in its single guarded
      // write, so a photo stored by another session after the check above is never replaced.
      await completeAvatarUpload({
        data: { objectKey: photoKeyRef.current, expectedPreviousKey: null }
      });
      return 'saved';
    } catch (error) {
      if (error instanceof Error && error.message === 'UNAUTHENTICATED') throw error;
      return error instanceof Error && error.message === 'AVATAR_CONFLICT' ? 'conflict' : 'failed';
    }
  }

  // The authoritative profile decides whether a create/claim committed (lost response, failed
  // readback, or a claim reported as no longer pending): a missing profile or a failed read is
  // NOT proof, so the caller fails closed. An expired session is not an answer either: it is
  // rethrown so the caller redirects to login.
  async function profileExists(): Promise<boolean> {
    try {
      await getMyPlayerProfile();
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
    setPhotoIssue(null);
    try {
      if (profile && !committedRef.current) {
        try {
          if (claim) await claimProvisionalPlayer({ data: profile });
          else await onboardPlayer({ data: profile });
        } catch (error) {
          if (!(error instanceof Error) || error.message === 'UNAUTHENTICATED') throw error;
          // A lost response, or a claim reported as no longer pending, only counts as committed
          // when the profile really exists; otherwise the original error stays a retryable failure.
          const ambiguous = claim ? error.message === 'PLAYER_CLAIM_NOT_PENDING' : true;
          if (!ambiguous || !(await profileExists())) throw error;
        }
        committedRef.current = true;
        setCommitted(true);
      }
      if (withPhoto && photo) {
        const result = await savePhoto(photo);
        if (result !== 'saved') {
          setPhotoIssue(result);
          return;
        }
      }
      await continueAfterProfile();
    } catch (error) {
      if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
        navigate('/login?next=/onboarding');
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

  const levelText = level && Number.isFinite(selectedLevel) ? formatLevel(selectedLevel) : '—';
  const levelValue = (
    <output
      htmlFor={levelLocked ? 'player-level' : 'player-level-slider player-level'}
      {...stylex.props(claim && !levelLocked ? styles.label : styles.levelValue)}
    >
      {levelText}
    </output>
  );
  const slider = (
    <>
      <div {...stylex.props(styles.track)}>
        <div
          aria-hidden="true"
          {...stylex.props(
            styles.rail(`${((sliderLevel - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL)) * 100}%`)
          )}
        />
        <input
          id="player-level-slider"
          type="range"
          min={MIN_LEVEL}
          max={MAX_LEVEL}
          step={LEVEL_STEP}
          value={sliderLevel}
          onChange={(event) => setLevel(Number(event.target.value).toFixed(1))}
          disabled={levelLocked || locked}
          aria-label={t('onboarding.levelScale')}
          aria-valuetext={formatLevel(sliderLevel)}
          aria-describedby={levelLocked ? 'claim-level-locked' : 'level-range-description'}
          {...stylex.props(styles.slider)}
        />
      </div>
      <div id="level-range-description" {...stylex.props(styles.endpoints)}>
        <span>
          {formatLevel(MIN_LEVEL)}
          {!claim && (
            <>
              {' '}
              <span>{t('onboarding.beginner')}</span>
            </>
          )}
        </span>
        <span>
          {formatLevel(MAX_LEVEL)}
          {!claim && (
            <>
              {' '}
              <span>{t('onboarding.advanced')}</span>
            </>
          )}
        </span>
      </div>
    </>
  );
  const claimNotice = claim && claim.matchCount > 0 && (
    <div {...stylex.props(styles.notice)}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        data-testid="claim-notice-icon"
        {...stylex.props(styles.noticeIcon)}
      >
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </svg>
      <p {...stylex.props(styles.noticeText)}>
        {t('auth.claim.invitedNotice', { count: claim.matchCount })}
      </p>
    </div>
  );
  const sideField = (
    <fieldset
      aria-invalid={Boolean(errors.side)}
      aria-describedby={errors.side ? 'player-side-error' : undefined}
      {...stylex.props(ui.fieldset, ui.bareFieldset, styles.fieldset)}
    >
      <legend {...stylex.props(ui.srOnly)}>{t('onboarding.side')}</legend>
      <span aria-hidden="true" {...stylex.props(styles.label)}>
        {t('onboarding.side')}
      </span>
      <div {...stylex.props(styles.choices)}>
        {(['LEFT', 'RIGHT', 'EITHER'] as const).map((value, index) => (
          <label
            key={value}
            {...stylex.props(
              styles.choice,
              side === value && styles.chosen,
              locked && styles.disabled
            )}
          >
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
  );
  const handField = (
    <fieldset {...stylex.props(ui.fieldset, ui.bareFieldset, styles.fieldset)}>
      <legend {...stylex.props(ui.srOnly)}>{t('onboarding.hand')}</legend>
      <span aria-hidden="true" {...stylex.props(styles.label)}>
        {t('onboarding.hand')}
      </span>
      <div id="player-hand-options" {...stylex.props(styles.choices)}>
        {[
          { value: 'LEFT' as const, label: t('onboarding.handLeft') },
          { value: 'RIGHT' as const, label: t('onboarding.handRight') },
          { value: null, label: t('onboarding.handPreferNot') }
        ].map(({ value, label }) => (
          <label
            key={value ?? 'prefer-not'}
            {...stylex.props(
              styles.choice,
              hand === value && styles.chosen,
              locked && styles.disabled
            )}
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
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <main {...stylex.props(chrome.page, styles.page)}>
      <AuthTopBar title={t('onboarding.barTitle')} />
      <form onSubmit={(event) => void submit(event)} noValidate {...stylex.props(chrome.form)}>
        <div {...stylex.props(chrome.content, claim ? styles.claimContent : styles.content)}>
          <div
            data-testid="onboarding-progress"
            aria-hidden="true"
            {...stylex.props(styles.progress)}
          >
            <span {...stylex.props(styles.segment, styles.completeSegment)} />
            <span {...stylex.props(styles.segment, styles.completeSegment)} />
            <span {...stylex.props(styles.segment)} />
          </div>
          <p {...stylex.props(styles.step)}>{t('onboarding.step')}</p>
          {!levelLocked && claimNotice}
          <h1 {...stylex.props(chrome.title)}>
            {t(levelLocked ? 'auth.claim.lockedLevelTitle' : 'onboarding.title')}
          </h1>
          {!claim && <p {...stylex.props(chrome.body)}>{t('onboarding.subtitle')}</p>}
          {levelLocked ? (
            <SurfaceCard data-testid="onboarding-level" xstyle={styles.levelCard}>
              <div {...stylex.props(styles.valueRow)}>
                {levelValue}
                <span {...stylex.props(styles.locked)}>
                  <svg
                    aria-hidden="true"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="5" y="10" width="14" height="11" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                  {t('auth.claim.locked')}
                </span>
              </div>
              <p id="claim-level-locked" {...stylex.props(chrome.meta)}>
                {t('auth.claim.levelLocked')}
              </p>
            </SurfaceCard>
          ) : claim ? (
            <div data-testid="onboarding-level" {...stylex.props(styles.estimated)}>
              <div {...stylex.props(styles.estimatedRow)}>
                <span {...stylex.props(styles.label)}>{t('auth.claim.estimatedLevel')}</span>
                {levelValue}
              </div>
              {slider}
              <p {...stylex.props(chrome.meta)}>{t('auth.claim.levelNote')}</p>
            </div>
          ) : (
            <SurfaceCard data-testid="onboarding-level" xstyle={styles.levelCard}>
              <div {...stylex.props(styles.valueRow)}>
                {levelValue}
                <span {...stylex.props(styles.label)}>{t('onboarding.level')}</span>
              </div>
              {slider}
            </SurfaceCard>
          )}
          {levelLocked ? (
            <>
              {handField}
              {sideField}
            </>
          ) : (
            <>
              {sideField}
              {handField}
            </>
          )}
          {levelLocked && claimNotice}
          <p {...stylex.props(chrome.meta)}>
            {t(claim ? 'auth.claim.subtitle' : 'onboarding.scaleDescription')}
          </p>
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
          <SurfaceCard>
            {levelLocked && slider}
            <label htmlFor="player-level" {...stylex.props(styles.label)}>
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
              {...stylex.props(ui.input, styles.extraInput)}
            />
            {errors.level && (
              <p id="player-level-error" role="alert" {...stylex.props(ui.error)}>
                {t(errors.level)}
              </p>
            )}
          </SurfaceCard>
          <SurfaceCard>
            <label htmlFor="onboard-bio" {...stylex.props(styles.label)}>
              {t('onboarding.bio')}
            </label>
            <textarea
              id="onboard-bio"
              maxLength={280}
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              disabled={locked}
              {...stylex.props(ui.input, ui.textarea, styles.extraInput)}
            />
          </SurfaceCard>
          <SurfaceCard>
            <h2 {...stylex.props(styles.label)}>{t('profile.availability')}</h2>
            <AvailabilityFields
              onboarding
              days={days}
              times={times}
              onDaysChange={setDays}
              onTimesChange={setTimes}
              disabled={locked}
            />
          </SurfaceCard>

          <SurfaceCard>
            <StepBadge>
              {t('onboarding.reliabilityLabel', { value: INITIAL_RELIABILITY_PERCENT })}
            </StepBadge>
            <p {...stylex.props(ui.muted)}>{t('onboarding.reliabilityHelp')}</p>
          </SurfaceCard>
        </div>
        <AuthActionBar xstyle={styles.actions}>
          {failed && (
            <p role="alert" {...stylex.props(ui.error)}>
              {t(claim ? 'auth.claim.failed' : 'onboarding.failed')}
            </p>
          )}
          {photoIssue ? (
            <div {...stylex.props(ui.stack)}>
              <p role="alert" {...stylex.props(ui.error)}>
                {t(
                  photoIssue === 'conflict'
                    ? 'onboarding.avatarConflict'
                    : 'onboarding.avatarFailed'
                )}
              </p>
              {photoIssue === 'failed' && (
                <Button busy={saving} onClick={() => void complete({ withPhoto: true })}>
                  {t('onboarding.avatarRetry')}
                </Button>
              )}
              <Button
                ref={photoIssue === 'conflict' ? conflictContinueRef : undefined}
                variant={photoIssue === 'failed' ? 'secondary' : 'primary'}
                busy={photoIssue === 'conflict' && saving}
                disabled={saving}
                onClick={() => void complete({ withPhoto: false })}
              >
                {t(
                  photoIssue === 'conflict'
                    ? 'onboarding.avatarConflictContinue'
                    : 'onboarding.avatarContinue'
                )}
              </Button>
            </div>
          ) : (
            <Button type="submit" busy={saving}>
              {t(saving ? 'onboarding.saving' : claim ? 'auth.claim.submit' : 'onboarding.save')}
            </Button>
          )}
        </AuthActionBar>
      </form>
    </main>
  );
}
