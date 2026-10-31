import { Dialog } from '@base-ui/react/dialog';
import * as stylex from '@stylexjs/stylex';
import { useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { stripEdgeWhitespace } from '../../lib/edge-whitespace';
import { TextField } from '../../components/ui/TextField';
import { LEVEL_STEP, MAX_LEVEL, MIN_LEVEL } from '../player/rating-config';
import { ui } from '../player/player-ui.styles';
import {
  firstInvalidField,
  validateAddPlayerForm,
  type AddPlayerFieldErrors,
  type AddPlayerFields
} from './match-add-player-form';
import { addPlayerStyles as s } from './match-add-player.styles';
import { matchManagementStyles as management } from './match-management.styles';

const NAME_MAX_CODE_POINTS = 80;

function AddMatchPlayerForm({
  pending,
  feedbackKey,
  onSubmit
}: {
  pending: boolean;
  feedbackKey: string | null;
  onSubmit: (fields: AddPlayerFields) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const levelRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // Unselected until the organizer commits a value: no silent default estimate.
  const [level, setLevel] = useState<string | null>(null);
  const [errors, setErrors] = useState<AddPlayerFieldErrors>({});
  const formatLevel = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value);
  const selected = level === null ? null : Number(level);
  const sliderLevel = selected ?? MIN_LEVEL;
  const levelErrorId = `${id}-level-error`;
  const levelHelperId = `${id}-level-helper`;
  const levelLabelId = `${id}-level-label`;

  function commitLevel(value: string) {
    setLevel(Number(value).toFixed(1));
    setErrors((current) => ({ ...current, level: undefined }));
  }

  // Validator counts code points; an HTML maxLength counts UTF-16 units, so the limit is checked here.
  function changeName(value: string) {
    setName(value);
    setErrors((current) => ({
      ...current,
      name:
        Array.from(stripEdgeWhitespace(value)).length > NAME_MAX_CODE_POINTS
          ? 'matches.addPlayer.validation.name'
          : undefined
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const result = validateAddPlayerForm({ name, email, level });
    if (!result.ok) {
      setErrors(result.errors);
      const first = firstInvalidField(result.errors);
      (first === 'name' ? nameRef : first === 'email' ? emailRef : levelRef).current?.focus();
      return;
    }
    setErrors({});
    await onSubmit(result.value);
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate {...stylex.props(s.form)}>
      <TextField
        ref={nameRef}
        name="display-name"
        label={t('matches.addPlayer.nameLabel')}
        placeholder={t('matches.addPlayer.namePlaceholder')}
        autoComplete="off"
        required
        disabled={pending}
        value={name}
        onChange={(event) => changeName(event.target.value)}
        error={errors.name ? t(errors.name) : undefined}
      />
      <TextField
        ref={emailRef}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        label={t('matches.addPlayer.emailLabel')}
        helper={t('matches.addPlayer.emailHelper')}
        placeholder={t('matches.addPlayer.emailPlaceholder')}
        required
        maxLength={254}
        disabled={pending}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={errors.email ? t(errors.email) : undefined}
      />
      <div {...stylex.props(s.levelGroup)}>
        <div {...stylex.props(s.levelHeading)}>
          <span id={levelLabelId} {...stylex.props(s.levelLabel)}>
            {t('matches.addPlayer.levelLabel')}
          </span>
          <output
            htmlFor={`${id}-level`}
            {...stylex.props(selected === null ? s.levelUnset : s.levelValue)}
          >
            {selected === null ? t('matches.addPlayer.levelUnset') : formatLevel(selected)}
          </output>
        </div>
        <div {...stylex.props(ui.sliderGroup)}>
          <div {...stylex.props(ui.sliderTrack)}>
            <div
              {...stylex.props(ui.sliderFill)}
              style={{ width: `${(sliderLevel / MAX_LEVEL) * 100}%` }}
            />
            <input
              id={`${id}-level`}
              ref={levelRef}
              type="range"
              min={MIN_LEVEL}
              max={MAX_LEVEL}
              step={LEVEL_STEP}
              value={sliderLevel}
              disabled={pending}
              onChange={(event) => commitLevel(event.target.value)}
              onPointerUp={(event) => commitLevel(event.currentTarget.value)}
              aria-labelledby={levelLabelId}
              aria-valuetext={
                selected === null ? t('matches.addPlayer.levelUnset') : formatLevel(selected)
              }
              aria-invalid={errors.level ? true : undefined}
              aria-describedby={`${levelHelperId}${errors.level ? ` ${levelErrorId}` : ''}`}
              {...stylex.props(ui.sliderInput)}
            />
          </div>
          <div aria-hidden="true" {...stylex.props(ui.sliderLabels)}>
            <span>{formatLevel(MIN_LEVEL)}</span>
            <span>{formatLevel(MAX_LEVEL)}</span>
          </div>
        </div>
        <p id={levelHelperId} {...stylex.props(s.copy)}>
          {t('matches.addPlayer.levelHelper')}
        </p>
        {errors.level && (
          <p id={levelErrorId} role="alert" {...stylex.props(s.error)}>
            {t(errors.level)}
          </p>
        )}
      </div>
      <p {...stylex.props(s.note)}>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          {...stylex.props(s.noteIcon)}
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
        {t('matches.addPlayer.note')}
      </p>
      {feedbackKey && (
        <p role="alert" {...stylex.props(s.error, s.status)}>
          {t(feedbackKey)}
        </p>
      )}
      <div {...stylex.props(s.actions)}>
        <Dialog.Close disabled={pending} render={<Button variant="secondary" xstyle={s.action} />}>
          {t('matches.addPlayer.cancel')}
        </Dialog.Close>
        <Button type="submit" busy={pending} xstyle={s.action}>
          {t(pending ? 'matches.addPlayer.submitting' : 'matches.addPlayer.submit')}
        </Button>
      </div>
    </form>
  );
}

export function AddMatchPlayerDialog({
  open,
  onOpenChange,
  pending,
  feedbackKey,
  returnFocus,
  onSubmit
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  pending: boolean;
  feedbackKey: string | null;
  returnFocus: RefObject<HTMLButtonElement | null>;
  onSubmit: (fields: AddPlayerFields) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value);
      }}
      disablePointerDismissal={pending}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(management.backdrop)} />
        <Dialog.Popup
          finalFocus={() =>
            returnFocus.current?.isConnected
              ? returnFocus.current
              : document.getElementById('match-detail-heading')
          }
          {...stylex.props(management.popup, s.popup)}
        >
          <div {...stylex.props(s.heading)}>
            <Dialog.Title {...stylex.props(s.title)}>{t('matches.addPlayer.title')}</Dialog.Title>
            <Dialog.Description {...stylex.props(s.copy)}>
              {t('matches.addPlayer.subtitle')}
            </Dialog.Description>
          </div>
          <AddMatchPlayerForm
            pending={pending}
            feedbackKey={feedbackKey}
            onSubmit={async (fields) => {
              if (await onSubmit(fields)) onOpenChange(false);
            }}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
