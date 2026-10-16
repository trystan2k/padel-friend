import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBrowserClient } from '../../lib/supabase/client';
import {
  finalizeMatchPhotoUploadFn,
  removeUnpublishedMatchPhotoFn,
  signUnattachedMatchPhotoFn
} from './match-photo.functions';
import {
  MATCH_PHOTO_BUCKET,
  matchesMatchPhotoMagicBytes,
  matchPhotoExtension,
  validateMatchPhotoFile
} from './match-photo';
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
  const [photoPreview, setPhotoPreview] = useState<{ key: string; url: string } | null>(null);
  const [signingFailed, setSigningFailed] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
      onBusyChange?.(false);
    },
    [onBusyChange]
  );
  useEffect(() => {
    let active = true;
    if (photo) {
      void signUnattachedMatchPhotoFn({ data: { object_key: photo } })
        .then((url) => {
          if (active) {
            setPhotoPreview({ key: photo, url });
            setSigningFailed(null);
          }
        })
        .catch(() => {
          if (active) setSigningFailed(photo);
        });
    }
    return () => {
      active = false;
    };
  }, [photo]);
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
          {...stylex.props(s.fileInput)}
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
              // The browser uploads the staged object directly with its own JWT (the same
              // pattern as venue photos; a POST server function cannot carry a File), then
              // the finalize server function authorizes the exact key and re-verifies bytes.
              validateMatchPhotoFile(file);
              const magic = new Uint8Array(await file.slice(0, 12).arrayBuffer());
              if (!matchesMatchPhotoMagicBytes(file.type, magic))
                throw new Error('INVALID_MATCH_PHOTO');
              const client = getBrowserClient();
              const { data: authData, error: authError } = await client.auth.getClaims();
              const userId = authData?.claims?.sub;
              if (authError || typeof userId !== 'string') throw new Error('UNAUTHENTICATED');
              const key = `${communityId}/${eventId}/${userId}/${crypto.randomUUID()}.${matchPhotoExtension(file.type)}`;
              const { error: uploadError } = await client.storage
                .from(MATCH_PHOTO_BUCKET)
                .upload(key, file, { upsert: false, contentType: file.type });
              if (uploadError) throw uploadError;
              if (request !== generation.current) {
                await removeUnpublishedMatchPhotoFn({ data: { object_key: key } }).catch(
                  () => undefined
                );
                return;
              }
              await finalizeMatchPhotoUploadFn({
                data: { community_id: communityId, event_id: eventId, object_key: key }
              });
              if (request !== generation.current) {
                await removeUnpublishedMatchPhotoFn({ data: { object_key: key } }).catch(
                  () => undefined
                );
                return;
              }
              if (photo)
                await removeUnpublishedMatchPhotoFn({ data: { object_key: photo } }).catch(
                  () => undefined
                );
              onChange(key);
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
          {photoPreview?.key === photo ? (
            <img
              {...stylex.props(s.photo)}
              src={photoPreview.url}
              alt={t('matchCreate.fields.photo')}
            />
          ) : signingFailed === photo ? (
            <output>{t('matchCreate.photo.unavailable')}</output>
          ) : null}
          <button type="button" onClick={() => void remove()} {...stylex.props(s.button)}>
            {t('matchCreate.photo.remove')}
          </button>
        </>
      )}
    </section>
  );
}
