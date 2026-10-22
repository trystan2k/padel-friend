import { Dialog } from '@base-ui/react/dialog';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatchEventDetail } from './match-contracts';
import { MatchDetailTextField, MatchDetailCurrencyField } from './MatchDetailsForm';
import { matchEditDraft, type MatchEditDraft } from './match-management-edit';
import { validateMatchEditDraft } from './match-management.validators';
import { useMatchEdit } from './use-match-edit';
import { matchManagementStyles as s } from './match-management.styles';

/** Mount per explicit open, not per loader version: conflicts must retain drafts. */
export function MatchEditDialog({
  event,
  version,
  onClose,
  returnFocus
}: {
  event: MatchEventDetail;
  version: number;
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const [snapshot] = useState(() => ({ event, version }));
  const [draft, setDraft] = useState(() => matchEditDraft(event));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const action = useMatchEdit(snapshot.event.event_id, snapshot.version);
  const change = <K extends keyof MatchEditDraft>(key: K, value: MatchEditDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors({});
  };
  const field = (
    name: Exclude<keyof MatchEditDraft, 'currency' | 'eventType'>,
    type: 'text' | 'url' | 'number' | 'datetime-local' = 'text'
  ) => (
    <MatchDetailTextField
      key={name}
      name={name}
      value={draft[name]}
      onChange={(value) => change(name, value)}
      type={type}
      error={errors[name]}
      constraints={
        type === 'number'
          ? { min: name === 'price' ? 0 : 1, step: name === 'price' ? '0.01' : 1 }
          : type === 'datetime-local'
            ? { step: 1 }
            : {}
      }
    />
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !action.pending) onClose();
      }}
      disablePointerDismissal={action.pending}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(s.backdrop)} />
        <Dialog.Popup
          {...stylex.props(s.popup)}
          finalFocus={() =>
            returnFocus.current?.isConnected
              ? returnFocus.current
              : document.getElementById('match-detail-heading')
          }
        >
          <Dialog.Title>{t('matches.management.edit.title')}</Dialog.Title>
          <Dialog.Description>{t('matches.reconfirmation.description')}</Dialog.Description>
          {action.conflict && (
            <section role="alert" {...stylex.props(s.section)}>
              <h3>{t('matches.management.edit.conflictTitle')}</h3>
              <p>{t('matches.management.edit.conflictDescription')}</p>
              <div {...stylex.props(s.row)}>
                <button
                  type="button"
                  {...stylex.props(s.button)}
                  disabled={action.pending}
                  onClick={async () => {
                    if (await action.reload()) onClose();
                  }}
                >
                  {t('matches.management.edit.reload')}
                </button>
                <button
                  type="button"
                  {...stylex.props(s.button)}
                  onClick={() => form.current?.querySelector<HTMLInputElement>('input')?.focus()}
                >
                  {t('matches.management.edit.reviewDraft')}
                </button>
              </div>
            </section>
          )}
          <form
            ref={form}
            noValidate
            {...stylex.props(s.section)}
            onSubmit={async (e) => {
              e.preventDefault();
              if (action.pending || action.conflict || saved) return;
              const { patch, errors: next } = validateMatchEditDraft(
                draft,
                snapshot.event,
                snapshot.version
              );
              setErrors(next);
              if (Object.keys(next).length) {
                // Error DOM renders before focus; no automatic consent/version rebasing.
                requestAnimationFrame(() =>
                  form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
                );
                return;
              }
              if (await action.save(patch)) setSaved(true);
            }}
          >
            <fieldset disabled={action.pending || saved} {...stylex.props(s.section)}>
              <label>
                {t('matchCreate.fields.type')}
                <select
                  value={draft.eventType}
                  onChange={(e) =>
                    change(
                      'eventType',
                      e.target.value === 'competitive' ? 'competitive' : 'friendly'
                    )
                  }
                  {...stylex.props(s.input)}
                >
                  <option value="friendly">{t('matches.type.friendly')}</option>
                  <option value="competitive">{t('matches.type.competitive')}</option>
                </select>
              </label>
              {field('startsAt', 'datetime-local')}
              {field('venueName')}
              {field('mapsUrl', 'url')}
              {field('courtNotes')}
              {field('price', 'number')}
              <MatchDetailCurrencyField
                value={draft.currency}
                onChange={(value) => change('currency', value)}
                error={errors.currency}
              />
              {field('paymentNote')}
              {field('notes')}
              {field('maximumRegistrations', 'number')}
              {field('cutoff', 'datetime-local')}
            </fieldset>
            <output aria-live="polite">{action.feedback ? t(action.feedback) : null}</output>
            <div {...stylex.props(s.row)}>
              <Dialog.Close disabled={action.pending} {...stylex.props(s.button)}>
                {t('matches.management.cancel')}
              </Dialog.Close>
              <button
                type="submit"
                {...stylex.props(s.button)}
                disabled={action.pending || action.conflict || saved}
                aria-busy={action.pending}
              >
                {t('matches.management.edit.save')}
              </button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
