import * as stylex from '@stylexjs/stylex';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { HeroCard } from '../../components/ui/HeroCard';
import { StepBadge } from '../../components/ui/StepBadge';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { TextField } from '../../components/ui/TextField';
import { stripDisplayNameEdgeWhitespace } from './display-name';
import { onboardPlayer } from './player.functions';
import { INITIAL_RELIABILITY_PERCENT, LEVEL_STEP, MAX_LEVEL, MIN_LEVEL } from './rating-config';
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
  const [hand, setHand] = useState<'LEFT' | 'RIGHT' | null>(null);
  const [bio, setBio] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'name' | 'side' | 'level', string>>>({});
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectedLevel = Number(level);
  const sliderLevel = Number.isFinite(selectedLevel)
    ? Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, selectedLevel))
    : MIN_LEVEL;
  const formatLevel = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value);

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
          dominant_hand: hand,
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
        <TextField
          id="player-name"
          name="display-name"
          label={t('onboarding.name')}
          ref={nameRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={80}
          error={errors.name ? t(errors.name) : undefined}
        />
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
                aria-label={t('onboarding.levelScale')}
                aria-describedby="level-range-description"
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
            {t('onboarding.failed')}
          </p>
        )}
        <Button type="submit" busy={saving}>
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
