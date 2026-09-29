import * as stylex from '@stylexjs/stylex';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { stripDisplayNameEdgeWhitespace } from './display-name';
import { onboardPlayer } from './player.functions';
import { formatDisplayLevel, INITIAL_RELIABILITY_PERCENT } from './rating-config';
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
  const scaleTenths = [0, 20, 30, 40, 50, 70];
  const selectedTenth = Math.round(Number(level) * 10);
  if (selectedTenth >= 0 && selectedTenth <= 70 && !scaleTenths.includes(selectedTenth))
    scaleTenths[2] = selectedTenth;

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
        <span {...stylex.props(ui.step)}>{t('onboarding.step')}</span>
        <header {...stylex.props(ui.header)}>
          <h1 {...stylex.props(ui.title)}>{t('onboarding.title')}</h1>
          <p {...stylex.props(ui.subtitle)}>{t('onboarding.subtitle')}</p>
        </header>
      </div>
      <div {...stylex.props(ui.hero)}>
        <h2 {...stylex.props(ui.heroTitle)}>{t('onboarding.levelHelp')}</h2>
        <p {...stylex.props(ui.heroCopy)}>{t('onboarding.scaleDescription')}</p>
      </div>
      <form
        onSubmit={(event) => void submit(event)}
        noValidate
        {...stylex.props(ui.stack, ui.onboardingForm)}
      >
        <div {...stylex.props(ui.card, ui.nameCard)}>
          <label htmlFor="player-name" {...stylex.props(ui.label)}>
            {t('onboarding.name')}
          </label>
          <input
            id="player-name"
            ref={nameRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'player-name-error' : undefined}
            {...stylex.props(ui.input)}
          />
          {errors.name && (
            <p id="player-name-error" role="alert" {...stylex.props(ui.error)}>
              {t(errors.name)}
            </p>
          )}
        </div>
        <div {...stylex.props(ui.card)}>
          <div {...stylex.props(ui.row)}>
            <label htmlFor="player-level" {...stylex.props(ui.label)}>
              {t('onboarding.level')}
            </label>
            <output htmlFor="player-level" {...stylex.props(ui.level)}>
              {level && Number.isFinite(Number(level))
                ? formatDisplayLevel(Number(level), i18n.language)
                : t('onboarding.validationLevel')}
            </output>
          </div>
          <fieldset {...stylex.props(ui.fieldset, ui.bareFieldset)}>
            <legend {...stylex.props(ui.srOnly)}>{t('onboarding.levelScale')}</legend>
            <div {...stylex.props(ui.scale)}>
              {scaleTenths.map((tenth) => {
                const value = (tenth / 10).toFixed(1);
                return (
                  <button
                    key={tenth}
                    type="button"
                    aria-label={t('onboarding.levelChoice', {
                      level: formatDisplayLevel(tenth / 10, i18n.language)
                    })}
                    aria-pressed={level === value}
                    onClick={() => setLevel(value)}
                    {...stylex.props(ui.scaleChip, level === value && ui.scaleSelected)}
                  >
                    {new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(
                      tenth / 10
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div {...stylex.props(ui.scaleCaption)}>
            <span>{t('onboarding.beginner')}</span>
            <span>{t('onboarding.advanced')}</span>
          </div>
          <input
            id="player-level"
            ref={levelRef}
            type="number"
            inputMode="decimal"
            min="0"
            max="7"
            step="0.1"
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
        </div>
        <fieldset
          aria-invalid={Boolean(errors.side)}
          aria-describedby={errors.side ? 'player-side-error' : undefined}
          {...stylex.props(ui.card, ui.fieldset)}
        >
          <legend {...stylex.props(ui.label)}>{t('onboarding.side')}</legend>
          <div {...stylex.props(ui.choices)}>
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
                    ? 'onboarding.sideLeft'
                    : value === 'RIGHT'
                      ? 'onboarding.sideRight'
                      : 'onboarding.sideEither'
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
        <div {...stylex.props(ui.card)}>
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
        </div>
        <div {...stylex.props(ui.card)}>
          <strong {...stylex.props(ui.step)}>
            {t('profile.reliability')}:{' '}
            {t('profile.percent', { value: INITIAL_RELIABILITY_PERCENT })}
          </strong>
          <p {...stylex.props(ui.muted)}>{t('onboarding.reliabilityHelp')}</p>
        </div>
        {failed && (
          <p role="alert" {...stylex.props(ui.error)}>
            {t('onboarding.failed')}
          </p>
        )}
        <button type="submit" disabled={saving} {...stylex.props(ui.button)}>
          {saving ? (
            t('onboarding.saving')
          ) : (
            <>
              {t('onboarding.save')} <span aria-hidden="true">→</span>
            </>
          )}
        </button>
      </form>
    </main>
  );
}
