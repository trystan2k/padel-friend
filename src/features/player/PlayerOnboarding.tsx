import * as stylex from '@stylexjs/stylex';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { HeroCard } from '../../components/ui/HeroCard';
import { StepBadge } from '../../components/ui/StepBadge';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { stripDisplayNameEdgeWhitespace } from './display-name';
import { onboardPlayer } from './player.functions';
import {
  formatDisplayLevel,
  INITIAL_RELIABILITY_PERCENT,
  LEVEL_STEP,
  MAX_LEVEL,
  MIN_LEVEL
} from './rating-config';
import { validateInitialLevel, type PreferredSide } from './player.validators';
import { ui } from './player-ui.styles';

export function PlayerOnboarding() {
  const { t, i18n } = useTranslation();
  const nameRef = useRef<HTMLInputElement>(null);
  const sideRef = useRef<HTMLInputElement>(null);
  const levelRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [side, setSide] = useState<PreferredSide | null>(null);
  const [level, setLevel] = useState('3.0');
  const [hand, setHand] = useState<'LEFT' | 'RIGHT' | ''>('');
  const [bio, setBio] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'name' | 'side' | 'level', string>>>({});
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const scaleStepMultiplier = 1 / LEVEL_STEP;
  const minLevelTenth = MIN_LEVEL * scaleStepMultiplier;
  const maxLevelTenth = MAX_LEVEL * scaleStepMultiplier;
  const scaleTenths = [MIN_LEVEL, 2, 3, 4, 5, MAX_LEVEL].map(
    (chipLevel) => chipLevel * scaleStepMultiplier
  );
  const selectedTenth = Math.round(Number(level) * scaleStepMultiplier);
  if (
    selectedTenth >= minLevelTenth &&
    selectedTenth <= maxLevelTenth &&
    !scaleTenths.includes(selectedTenth)
  )
    scaleTenths[2] = selectedTenth;
  scaleTenths.sort((a, b) => a - b);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    const normalizedName = stripDisplayNameEdgeWhitespace(name);
    if (!normalizedName || Array.from(normalizedName).length > 80)
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
    setSaving(true);
    setFailed(false);
    let navigating = false;
    try {
      await onboardPlayer({
        data: {
          display_name: normalizedName,
          preferred_side: side,
          initial_level: initialLevel,
          dominant_hand: hand || null,
          bio: bio.trim() || null
        }
      });
      navigating = true;
      window.location.assign('/dashboard');
    } catch (error) {
      if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
        navigating = true;
        window.location.assign('/login?next=/onboarding');
        return;
      }
      setFailed(true);
    } finally {
      if (!navigating) setSaving(false);
    }
  }

  return (
    <main {...stylex.props(ui.page, ui.onboardingPage)}>
      <div {...stylex.props(ui.topContent)}>
        <StepBadge>{t('onboarding.step')}</StepBadge>
        <header {...stylex.props(ui.header)}>
          <h1 {...stylex.props(ui.title)}>{t('onboarding.title')}</h1>
          <p {...stylex.props(ui.subtitle)}>{t('onboarding.subtitle')}</p>
        </header>
      </div>
      <HeroCard>
        <h2 {...stylex.props(ui.heroTitle)}>{t('onboarding.levelHelp')}</h2>
        <p {...stylex.props(ui.heroCopy)}>{t('onboarding.scaleDescription')}</p>
      </HeroCard>
      <form
        onSubmit={(event) => void submit(event)}
        noValidate
        {...stylex.props(ui.stack, ui.onboardingForm)}
      >
        <SurfaceCard xstyle={ui.nameCard}>
          <label htmlFor="player-name" {...stylex.props(ui.label, ui.nameField)}>
            {t('onboarding.name')}
            <input
              id="player-name"
              ref={nameRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'player-name-error' : undefined}
              {...stylex.props(ui.input, ui.onboardingNameInput)}
            />
          </label>
          {errors.name && (
            <p id="player-name-error" role="alert" {...stylex.props(ui.error)}>
              {t(errors.name)}
            </p>
          )}
        </SurfaceCard>
        <SurfaceCard>
          <div {...stylex.props(ui.onboardingLevelHeading)}>
            <span {...stylex.props(ui.label)}>{t('onboarding.level')}</span>
            <output htmlFor="player-level" {...stylex.props(ui.level, ui.onboardingLevelValue)}>
              {level && Number.isFinite(Number(level))
                ? new Intl.NumberFormat(i18n.language, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1
                  }).format(Number(level))
                : t('onboarding.validationLevel')}
            </output>
          </div>
          <fieldset {...stylex.props(ui.fieldset, ui.bareFieldset)}>
            <legend {...stylex.props(ui.srOnly)}>{t('onboarding.levelScale')}</legend>
            <div {...stylex.props(ui.scale, ui.onboardingScale)}>
              {scaleTenths.map((tenth) => {
                const value = (tenth * LEVEL_STEP).toFixed(1);
                return (
                  <button
                    key={tenth}
                    type="button"
                    aria-label={t('onboarding.levelChoice', {
                      level: formatDisplayLevel(tenth * LEVEL_STEP, i18n.language)
                    })}
                    aria-pressed={level === value}
                    onClick={() => setLevel(value)}
                    {...stylex.props(ui.scaleChip, level === value && ui.scaleSelected)}
                  >
                    {new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(
                      tenth * LEVEL_STEP
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div {...stylex.props(ui.scaleCaption, ui.onboardingScaleCaption)}>
            <span>{t('onboarding.beginner')}</span>
            <span>{t('onboarding.advanced')}</span>
          </div>
        </SurfaceCard>
        <fieldset
          aria-invalid={Boolean(errors.side)}
          aria-describedby={errors.side ? 'player-side-error' : undefined}
          {...stylex.props(ui.card, ui.fieldset)}
        >
          <legend {...stylex.props(ui.srOnly)}>{t('onboarding.side')}</legend>
          <span aria-hidden="true" {...stylex.props(ui.label)}>
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
        <SurfaceCard>
          <StepBadge>
            {t('onboarding.reliabilityLabel', { value: INITIAL_RELIABILITY_PERCENT })}
          </StepBadge>
          <p {...stylex.props(ui.muted)}>{t('onboarding.reliabilityHelp')}</p>
        </SurfaceCard>
        {failed && (
          <p role="alert" {...stylex.props(ui.error)}>
            {t('onboarding.failed')}
          </p>
        )}
        <Button type="submit" busy={saving} xstyle={ui.onboardingSubmit}>
          {saving ? (
            t('onboarding.saving')
          ) : (
            <>
              {t('onboarding.save')} <span aria-hidden="true">→</span>
            </>
          )}
        </Button>
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
          <label htmlFor="onboard-hand" {...stylex.props(ui.label)}>
            {t('profile.dominantHand')}
          </label>
          <select
            id="onboard-hand"
            value={hand}
            onChange={(event) =>
              setHand(
                event.target.value === 'LEFT' || event.target.value === 'RIGHT'
                  ? event.target.value
                  : ''
              )
            }
            {...stylex.props(ui.input)}
          >
            <option value="">{t('profile.handNone')}</option>
            <option value="LEFT">{t('profile.handLeft')}</option>
            <option value="RIGHT">{t('profile.handRight')}</option>
          </select>
          <label htmlFor="onboard-bio" {...stylex.props(ui.label)}>
            {t('profile.bio')}
          </label>
          <textarea
            id="onboard-bio"
            maxLength={280}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            {...stylex.props(ui.input, ui.textarea)}
          />
        </SurfaceCard>
      </form>
    </main>
  );
}
