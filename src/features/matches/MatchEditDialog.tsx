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
import { matchEditStyles as edit } from './match-edit.styles';
import { MatchManagementUnavailable } from './MatchManagementUnavailable';

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
      fieldStyle={edit.field}
      inputStyle={edit.input}
      placeholder={name === 'notes' ? t('matchCreate.helpers.optional') : undefined}
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
        <Dialog.Backdrop {...stylex.props(s.backdrop, edit.backdrop)} />
        <Dialog.Popup
          {...stylex.props(s.popup, edit.popup)}
          finalFocus={() =>
            returnFocus.current?.isConnected
              ? returnFocus.current
              : document.getElementById('match-detail-heading')
          }
        >
          <div {...stylex.props(edit.header)}>
            <Dialog.Title {...stylex.props(edit.title)}>
              {t('matches.management.edit.title')}
            </Dialog.Title>
            <Dialog.Close
              disabled={action.pending}
              aria-label={t('matches.management.close')}
              {...stylex.props(s.button, edit.button, edit.close)}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                {...stylex.props(s.icon)}
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </Dialog.Close>
          </div>
          <Dialog.Description {...stylex.props(edit.copy)}>
            {t('matches.reconfirmation.description')}
          </Dialog.Description>
          {action.unavailable && (
            <MatchManagementUnavailable reason={action.unavailable} onBack={onClose} focus />
          )}
          {action.conflict && (
            <section role="alert" {...stylex.props(edit.conflict)}>
              <h3 {...stylex.props(edit.conflictHeading)}>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  {...stylex.props(edit.warningIcon)}
                >
                  <path d="m10 4-8 14a2 2 0 0 0 2 3h16a2 2 0 0 0 2-3L14 4a2 2 0 0 0-4 0Z" />
                  <path d="M12 8v6m0 3v1" />
                </svg>
                {t('matches.management.edit.conflictTitle')}
              </h3>
              <p {...stylex.props(edit.copy)}>{t('matches.management.edit.conflictDescription')}</p>
              <div {...stylex.props(edit.columns)}>
                <button
                  type="button"
                  {...stylex.props(s.button, edit.button)}
                  disabled={action.pending}
                  onClick={async () => {
                    if (await action.reload()) onClose();
                  }}
                >
                  {t('matches.management.edit.reload')}
                </button>
                <button
                  type="button"
                  {...stylex.props(s.button, edit.button, edit.primary)}
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
            {...stylex.props(edit.form)}
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
            <fieldset
              disabled={action.pending || saved || !!action.unavailable}
              {...stylex.props(edit.fields)}
            >
              <label {...stylex.props(edit.field)}>
                {t('matchCreate.fields.type')}
                <select
                  value={draft.eventType}
                  onChange={(e) =>
                    change(
                      'eventType',
                      e.target.value === 'competitive' ? 'competitive' : 'friendly'
                    )
                  }
                  {...stylex.props(s.input, edit.input)}
                >
                  <option value="friendly">{t('matches.type.friendly')}</option>
                  <option value="competitive">{t('matches.type.competitive')}</option>
                </select>
              </label>
              {field('startsAt', 'datetime-local')}
              {field('venueName')}
              {field('mapsUrl', 'url')}
              {field('courtNotes')}
              <div {...stylex.props(edit.columns)}>
                {field('price', 'number')}
                <MatchDetailCurrencyField
                  value={draft.currency}
                  onChange={(value) => change('currency', value)}
                  error={errors.currency}
                  fieldStyle={edit.field}
                  inputStyle={edit.input}
                />
              </div>
              {field('paymentNote')}
              {field('notes')}
              {field('maximumRegistrations', 'number')}
              {field('cutoff', 'datetime-local')}
            </fieldset>
            {action.conflict && (
              <p {...stylex.props(edit.helper)}>{t('matches.management.edit.conflictHelper')}</p>
            )}
            {action.feedback && <output aria-live="polite">{t(action.feedback)}</output>}
            <div {...stylex.props(edit.columns)}>
              <Dialog.Close disabled={action.pending} {...stylex.props(s.button, edit.button)}>
                {t('matches.management.cancel')}
              </Dialog.Close>
              <button
                type="submit"
                {...stylex.props(s.button, edit.button, edit.primary)}
                disabled={action.pending || action.conflict || saved || !!action.unavailable}
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
