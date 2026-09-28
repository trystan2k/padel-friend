import * as stylex from '@stylexjs/stylex';
import { Dialog } from '@base-ui/react/dialog';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  main: { maxWidth: 640, marginInline: 'auto', padding: 'var(--space-20)' },
  card: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-16)',
    padding: 'var(--space-20)'
  },
  button: {
    backgroundColor: 'var(--color-green)',
    color: 'var(--color-surface)',
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: 'var(--radius-12)',
    padding: 'var(--space-8) var(--space-12)',
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
