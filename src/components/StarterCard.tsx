import * as stylex from '@stylexjs/stylex';
import { Dialog } from '@base-ui/react/dialog';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  main: { maxWidth: 640, marginInline: 'auto', padding: 'var(--space-lg)' },
  card: {
    backgroundColor: 'var(--surface-card)',
    borderRadius: 'var(--radius-card)',
    padding: 'var(--space-lg)'
  },
  button: {
    backgroundColor: 'var(--action-primary)',
    color: 'var(--action-text)',
    border: 0,
    borderRadius: 'var(--radius-card)',
    padding: 'var(--space-sm) var(--space-md)',
    cursor: 'pointer'
  }
});

export function StarterCard() {
  const { t } = useTranslation();
  return (
    <main {...stylex.props(styles.main)}>
      <section {...stylex.props(styles.card)}>
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
        <Dialog.Root>
          <Dialog.Trigger {...stylex.props(styles.button)}>{t('description')}</Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop />
            <Dialog.Popup>
              <Dialog.Title>{t('title')}</Dialog.Title>
              <Dialog.Description>{t('description')}</Dialog.Description>
              <Dialog.Close>{t('signOut')}</Dialog.Close>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </section>
    </main>
  );
}
