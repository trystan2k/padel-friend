import { Dialog } from '@base-ui/react/dialog';
import * as stylex from '@stylexjs/stylex';
import { useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { RESULT_REJECTION_REASONS } from './match-result.validators';
import type { ResultRejectionReason } from './match-result-model';
import { matchResultReviewStyles as s, matchResultStyles as base } from './match-result.styles';

const reasonCopy = {
  SCORE_INCORRECT: 'scoreIncorrect',
  TEAMS_INCORRECT: 'teamsIncorrect',
  PLAYERS_INCORRECT: 'playersIncorrect',
  GROUP_ASSIGNMENT_INCORRECT: 'groupAssignmentIncorrect',
  MATCH_DID_NOT_HAPPEN: 'matchDidNotHappen',
  MATCH_TYPE_INCORRECT: 'matchTypeIncorrect',
  CLASSIFICATION_INCORRECT: 'classificationIncorrect',
  OTHER: 'other'
} satisfies Record<ResultRejectionReason, string>;

export function MatchResultRejectDialog({
  groupNumber,
  submitterName,
  triggerRef,
  fallbackFocusRef,
  pending,
  feedbackMessage,
  onClose,
  onSubmit
}: {
  groupNumber: number;
  submitterName: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  fallbackFocusRef: RefObject<HTMLElement | null>;
  pending: boolean;
  feedbackMessage: string | null;
  onClose: () => void;
  onSubmit: (reasonCode: ResultRejectionReason, reasonNote: string | null) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const radioRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [reasonCode, setReasonCode] = useState<ResultRejectionReason | null>(null);
  const [note, setNote] = useState('');
  const [showReasonError, setShowReasonError] = useState(false);
  const [noteError, setNoteError] = useState<'required' | 'tooLong' | 'invalid' | null>(null);
  const reasonError = showReasonError && reasonCode === null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = note.trim();
    setShowReasonError(reasonCode === null);
    if (reasonCode === null) {
      radioRef.current?.focus();
      return;
    }
    if (note.length > 500) {
      setNoteError('tooLong');
      noteRef.current?.focus();
      return;
    }
    if (reasonCode === 'OTHER' && !trimmed) {
      setNoteError('required');
      noteRef.current?.focus();
      return;
    }
    if (trimmed.length > 0 && /\p{Cc}/u.test(trimmed)) {
      setNoteError('invalid');
      noteRef.current?.focus();
      return;
    }
    setNoteError(null);
    if (await onSubmit(reasonCode, trimmed || null)) onClose();
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
            initialFocus={radioRef}
            finalFocus={() =>
              triggerRef.current?.isConnected ? triggerRef.current : fallbackFocusRef.current
            }
            {...stylex.props(s.reviewPopup)}
          >
            <header {...stylex.props(s.dialogHeader)}>
              <Dialog.Title {...stylex.props(s.dialogTitle)}>
                {t('matches.results.reject.title')}
              </Dialog.Title>
              <Dialog.Description {...stylex.props(s.dialogDescription)}>
                {t('matches.results.reject.context', {
                  group: groupNumber,
                  name: submitterName
                })}
              </Dialog.Description>
            </header>
            <form
              noValidate
              {...stylex.props(s.dialogForm)}
              onSubmit={(event) => void submit(event)}
            >
              <fieldset
                disabled={pending}
                aria-describedby={reasonError ? `${id}-reason-error` : undefined}
                {...stylex.props(s.reasonFieldset)}
              >
                <legend {...stylex.props(s.reasonLegend)}>
                  {t('matches.results.reject.reasonLabel')}
                </legend>
                {RESULT_REJECTION_REASONS.map((reason, index) => (
                  <label key={reason} {...stylex.props(s.reasonOption)}>
                    <input
                      ref={index === 0 ? radioRef : undefined}
                      type="radio"
                      name={`${id}-reason`}
                      value={reason}
                      required
                      checked={reasonCode === reason}
                      onChange={() => {
                        setReasonCode(reason);
                        setShowReasonError(false);
                        setNoteError(null);
                      }}
                      {...stylex.props(s.reasonRadio)}
                    />
                    {t(`matches.results.reject.reasons.${reasonCopy[reason]}`)}
                  </label>
                ))}
                {reasonError && (
                  <p id={`${id}-reason-error`} role="alert" {...stylex.props(s.dialogError)}>
                    {t('matches.results.reject.reasonRequired')}
                  </p>
                )}
              </fieldset>
              <label {...stylex.props(s.noteField)}>
                <span>
                  {t('matches.results.reject.noteLabel')}{' '}
                  {reasonCode === 'OTHER' && (
                    <span {...stylex.props(s.reasonRequired)}>
                      {t('matches.results.reject.required')}
                    </span>
                  )}
                </span>
                <textarea
                  ref={noteRef}
                  id={`${id}-note`}
                  value={note}
                  maxLength={500}
                  rows={3}
                  disabled={pending}
                  required={reasonCode === 'OTHER'}
                  aria-invalid={noteError !== null || undefined}
                  aria-describedby={noteError !== null ? `${id}-note-error` : `${id}-note-hint`}
                  onChange={(event) => {
                    setNote(event.target.value);
                    setNoteError(null);
                  }}
                  {...stylex.props(s.noteInput)}
                />
              </label>
              <p id={`${id}-note-hint`} {...stylex.props(s.dialogHint)}>
                {t('matches.results.reject.noteHint')}
              </p>
              {noteError !== null && (
                <p id={`${id}-note-error`} role="alert" {...stylex.props(s.dialogError)}>
                  {t(
                    `matches.results.reject.note${noteError[0]!.toUpperCase()}${noteError.slice(1)}`
                  )}
                </p>
              )}
              {feedbackMessage && (
                <p role="alert" {...stylex.props(s.dialogError)}>
                  {feedbackMessage}
                </p>
              )}
              <p {...stylex.props(s.dialogNotice)}>
                {t('matches.results.reject.autoConfirmNotice')}
              </p>
              <div {...stylex.props(s.dialogActions)}>
                <Dialog.Close
                  disabled={pending}
                  type="button"
                  {...stylex.props(base.button, s.dialogAction)}
                >
                  {t('matches.results.reject.cancel')}
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={pending}
                  {...stylex.props(base.button, s.dialogAction, s.dialogSubmit)}
                >
                  {t(
                    pending ? 'matches.results.reject.submitting' : 'matches.results.reject.submit'
                  )}
                </button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
