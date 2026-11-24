import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { getPasswordStrength, type PasswordStrength as Strength } from './password-policy';
import { styles } from './password-strength.styles';

const LEVELS = {
  empty: { segments: 0, tone: null, label: 'auth.passwordStrengthEmpty' },
  weak: { segments: 1, tone: 'red', label: 'auth.passwordStrengthWeak' },
  fair: { segments: 2, tone: 'amber', label: 'auth.passwordStrengthFair' },
  good: { segments: 3, tone: 'green', label: 'auth.passwordStrengthGood' },
  strong: { segments: 4, tone: 'green', label: 'auth.passwordStrengthStrong' }
} as const satisfies Record<
  Strength,
  { segments: number; tone: 'red' | 'amber' | 'green' | null; label: string }
>;

const SEGMENTS = [1, 2, 3, 4];

export function PasswordStrength({ password }: { password: string }) {
  const { t } = useTranslation();
  const strength = getPasswordStrength(password);
  const { segments, tone, label } = LEVELS[strength];
  const valueTone =
    tone === 'red'
      ? styles.valueRed
      : tone === 'amber'
        ? styles.valueAmber
        : tone && styles.valueGreen;
  const segmentTone = tone && styles[tone];
  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.label)}>
        <span {...stylex.props(styles.title)}>{t('auth.passwordStrengthLabel')}</span>
        <span
          data-strength={strength}
          aria-live="polite"
          {...stylex.props(styles.value, valueTone)}
        >
          {t(label)}
        </span>
      </div>
      <div aria-hidden="true" {...stylex.props(styles.meter)}>
        {SEGMENTS.map((segment) => (
          <span
            key={segment}
            {...stylex.props(styles.segment, segment <= segments && segmentTone)}
          />
        ))}
      </div>
    </div>
  );
}
