import { useUpdateGuard } from '../pwa/update-guard';
import { Dialog } from '@base-ui/react/dialog';
import * as stylex from '@stylexjs/stylex';
import { useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { matchResultReviewStyles as s, matchResultStyles as base } from './match-result.styles';
import { resultCorrectionStyles as c } from './result-correction.styles';

export type CorrectionDialogDecision<V extends string = string> = {
  value: V;
  label: string;
  hint?: string;
};

/**
 * One bounded-justification dialog for every correction command that needs a typed reason:
 * requesting a correction (reason only) and resolving a dispute (a decision plus justification).
 * Focus returns to the trigger on close; each error is associated with its field.
 */
export function ResultCorrectionDialog<V extends string = string>({
  title,
  description,
  fieldLabel,
  submitLabel,
  decisions,
  decisionLegend,
  notice,
  destructive = false,
  pending,
  feedbackMessage,
  triggerRef,
  fallbackFocusRef,
  onClose,
  onSubmit
}: {
  title: string;
  description: string;
  fieldLabel: string;
  submitLabel: string;
  decisions?: CorrectionDialogDecision<V>[];
  decisionLegend?: string;
  notice?: string;
  destructive?: boolean;
  pending: boolean;
  feedbackMessage: string | null;
  triggerRef: RefObject<HTMLElement | null>;
  fallbackFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSubmit: (text: string, decision: V | null) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [decision, setDecision] = useState<V | null>(null);
  const [text, setText] = useState('');
  const [decisionError, setDecisionError] = useState(false);
  const [textError, setTextError] = useState<'required' | 'tooLong' | 'invalid' | null>(null);

  useUpdateGuard(pending || text.length > 0 || decision !== null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (decisions && decision === null) {
      setDecisionError(true);
      firstRef.current?.focus();
      return;
    }
    const problem =
      trimmed.length < 1
        ? 'required'
        : trimmed.length > 500
          ? 'tooLong'
          : /\p{Cc}/u.test(trimmed)
            ? 'invalid'
            : null;
    if (problem) {
      setTextError(problem);
      textRef.current?.focus();
      return;
    }
    if (await onSubmit(trimmed, decision)) onClose();
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      disablePointerDismissal={pending}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(s.reviewBackdrop)} />
        <Dialog.Viewport {...stylex.props(s.reviewViewport)}>
          <Dialog.Popup
            initialFocus={decisions ? firstRef : textRef}
            finalFocus={() =>
              triggerRef.current?.isConnected ? triggerRef.current : fallbackFocusRef.current
            }
            {...stylex.props(s.reviewPopup)}
          >
            <header {...stylex.props(s.dialogHeader)}>
              <Dialog.Title {...stylex.props(s.dialogTitle, decisions && c.resolveDialogTitle)}>
                {title}
              </Dialog.Title>
              <Dialog.Description {...stylex.props(s.dialogDescription)}>
                {description}
              </Dialog.Description>
            </header>
            <form noValidate {...stylex.props(s.dialogForm)} onSubmit={(e) => void submit(e)}>
              {decisions && (
                <fieldset
                  disabled={pending}
                  aria-describedby={decisionError ? `${id}-decision-error` : undefined}
                  {...stylex.props(s.reasonFieldset)}
                >
                  <legend {...stylex.props(s.reasonLegend)}>{decisionLegend}</legend>
                  {decisions.map((option, index) => (
                    <label
                      key={option.value}
                      {...stylex.props(
                        c.decisionOption,
                        decision === option.value && c.decisionSelected
                      )}
                    >
                      <input
                        ref={index === 0 ? firstRef : undefined}
                        type="radio"
                        name={`${id}-decision`}
                        value={option.value}
                        required
                        checked={decision === option.value}
                        onChange={() => {
                          setDecision(option.value);
                          setDecisionError(false);
                        }}
                        {...stylex.props(s.reasonRadio)}
                      />
                      <span>
                        {option.label}
                        {option.hint && <span {...stylex.props(c.muted)}> · {option.hint}</span>}
                      </span>
                    </label>
                  ))}
                  {decisionError && (
                    <p id={`${id}-decision-error`} role="alert" {...stylex.props(s.dialogError)}>
                      {t('matches.corrections.dialog.decisionRequired')}
                    </p>
                  )}
                </fieldset>
              )}
              <label {...stylex.props(s.noteField)}>
                <span>
                  {fieldLabel}{' '}
                  <span {...stylex.props(s.reasonRequired)}>
                    {t('matches.corrections.dialog.required')}
                  </span>
                </span>
                <textarea
                  ref={textRef}
                  id={`${id}-text`}
                  value={text}
                  maxLength={500}
                  rows={3}
                  disabled={pending}
                  required
                  aria-invalid={textError !== null || undefined}
                  aria-describedby={textError !== null ? `${id}-text-error` : `${id}-text-hint`}
                  onChange={(event) => {
                    setText(event.target.value);
                    setTextError(null);
                  }}
                  {...stylex.props(s.noteInput)}
                />
              </label>
              <p id={`${id}-text-hint`} {...stylex.props(s.dialogHint)}>
                {t('matches.corrections.dialog.hint')}
              </p>
              {textError !== null && (
                <p id={`${id}-text-error`} role="alert" {...stylex.props(s.dialogError)}>
                  {t(`matches.corrections.dialog.text.${textError}`)}
                </p>
              )}
              {feedbackMessage && (
                <p role="alert" {...stylex.props(s.dialogError)}>
                  {feedbackMessage}
                </p>
              )}
              {notice && <p {...stylex.props(s.dialogNotice)}>{notice}</p>}
              <div {...stylex.props(s.dialogActions)}>
                <Dialog.Close
                  disabled={pending}
                  type="button"
                  {...stylex.props(base.button, s.dialogAction)}
                >
                  {t('matches.corrections.dialog.cancel')}
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={pending}
                  {...stylex.props(
                    base.button,
                    s.dialogAction,
                    destructive ? s.dialogSubmit : c.primary
                  )}
                >
                  {pending ? t('matches.corrections.dialog.submitting') : submitLabel}
                </button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
