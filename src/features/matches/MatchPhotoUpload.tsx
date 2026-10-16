import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadMatchPhotoFn, removeUnpublishedMatchPhotoFn } from './match-photo.functions';
import { createMatchStyles as s } from './create-match.styles';

export function MatchPhotoUpload({
  communityId,
  eventId,
  photo,
  onChange,
  onBusyChange,
  invalid = false
}: {
  communityId: string;
  eventId: string;
  photo: string;
  onChange: (key: string) => void;
  onBusyChange?: (busy: boolean) => void;
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
      onBusyChange?.(false);
    },
    [onBusyChange]
  );
  async function remove() {
    if (photo) {
      try {
        await removeUnpublishedMatchPhotoFn({ data: { object_key: photo } });
      } catch {
        /* staging cleanup is best effort */
      }
      onChange('');
    }
  }
  return (
    <section {...stylex.props(s.fields)}>
      <label>
        {t('matchCreate.fields.photo')}
        <input
          type="file"
          aria-invalid={invalid || error}
          aria-describedby={invalid ? 'photo-error' : error ? 'photo-upload-error' : undefined}
          accept="image/jpeg,image/png,image/webp"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const request = ++generation.current;
            setBusy(true);
            onBusyChange?.(true);
            setError(false);
            try {
              const result: string = await uploadMatchPhotoFn({
                data: { community_id: communityId, event_id: eventId, file }
              });
              if (request !== generation.current) {
                await removeUnpublishedMatchPhotoFn({ data: { object_key: result } }).catch(
                  () => undefined
                );
                return;
              }
              if (photo)
                await removeUnpublishedMatchPhotoFn({ data: { object_key: photo } }).catch(
                  () => undefined
                );
              onChange(result);
            } catch {
              if (request === generation.current) setError(true);
            } finally {
              if (request === generation.current) {
                setBusy(false);
                onBusyChange?.(false);
              }
            }
          }}
        />
      </label>
      {invalid && (
        <p id="photo-error" role="alert">
          {t('matchCreate.errors.missingPhoto')}
        </p>
      )}
      {busy && <p aria-live="polite">{t('matchCreate.photo.uploading')}</p>}
      {error && (
        <p id="photo-upload-error" role="alert">
          {t('matchCreate.photo.unavailable')}
        </p>
      )}
      {photo && (
        <>
          <img src={photo} alt={t('matchCreate.fields.photo')} />
          <button type="button" onClick={() => void remove()} {...stylex.props(s.button)}>
            {t('matchCreate.photo.remove')}
          </button>
        </>
      )}
    </section>
  );
}
