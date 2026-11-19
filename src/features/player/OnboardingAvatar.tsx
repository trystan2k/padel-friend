import * as stylex from '@stylexjs/stylex';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { playerInitials } from './player-initials';
import { validateAvatarFile } from './player.validators';
import { ui } from './player-ui.styles';
import { onboardingStyles as styles } from './player-onboarding.styles';

type Props = {
  name: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
};

/**
 * Optional photo picker for onboarding. It only validates and previews the choice in memory:
 * nothing is uploaded until the profile exists (see `PlayerOnboarding`).
 */
export function OnboardingAvatar({ name, file, onFileChange, disabled = false }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const trimmedName = name.trim();
  const initials = playerInitials(name);
  const alt = trimmedName
    ? t('onboarding.avatarAlt', { name: trimmedName })
    : t('onboarding.avatarAltUnnamed');

  useEffect(() => {
    if (!preview) return undefined;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  function clearInput() {
    if (inputRef.current) inputRef.current.value = '';
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    // A cancelled picker reports no file: keep the previous valid choice and show no error.
    if (!selected) return;
    try {
      validateAvatarFile({ type: selected.type, size: selected.size });
    } catch {
      clearInput();
      setInvalid(true);
      setPreview(null);
      onFileChange(null);
      return;
    }
    setInvalid(false);
    setPreview(URL.createObjectURL(selected));
    onFileChange(selected);
  }

  function skip() {
    clearInput();
    setInvalid(false);
    setPreview(null);
    onFileChange(null);
  }

  return (
    <SurfaceCard data-testid="onboarding-avatar">
      <div {...stylex.props(styles.avatar)}>
        {file && preview ? (
          <img src={preview} alt={alt} {...stylex.props(ui.avatar)} />
        ) : (
          <span {...stylex.props(ui.avatar)}>
            <span aria-hidden="true">{initials}</span>
            <span {...stylex.props(ui.srOnly)}>{alt}</span>
          </span>
        )}
        <div {...stylex.props(styles.avatarBody)}>
          <label htmlFor={`${id}-file`} {...stylex.props(styles.label)}>
            {t('onboarding.avatarLabel')}
          </label>
          <div {...stylex.props(styles.avatarPicker, disabled && styles.disabled)}>
            <span aria-hidden="true" {...stylex.props(styles.fileName)}>
              {file?.name ?? t('onboarding.avatarChoose')}
            </span>
            <input
              ref={inputRef}
              id={`${id}-file`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={disabled}
              aria-invalid={invalid}
              aria-describedby={invalid ? `${id}-error` : `${id}-help`}
              onChange={chooseFile}
              {...stylex.props(styles.avatarFile)}
            />
          </div>
          <p id={`${id}-help`} {...stylex.props(ui.muted)}>
            {t('onboarding.avatarHelp')}
          </p>
          {invalid && (
            <p id={`${id}-error`} role="alert" {...stylex.props(ui.error)}>
              {t('onboarding.avatarInvalid')}
            </p>
          )}
          <Button type="button" variant="secondary" onClick={skip} disabled={disabled}>
            {t('onboarding.avatarSkip')}
          </Button>
        </div>
      </div>
    </SurfaceCard>
  );
}
