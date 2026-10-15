import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBrowserClient } from '../../lib/supabase/client';
import { finalizeCommunityVenuePhoto } from './community-venue-photo.functions';
import { COMMUNITY_VENUE_PHOTO_BUCKET, validateVenuePhotoFile } from './venue-photo';

type Props = {
  communityId: string;
  venueId: string;
  photoUrl: string | null;
  onUploaded: () => void;
};
const styles = stylex.create({
  root: { display: 'grid', gap: 'var(--space-4)', minWidth: 0 },
  preview: {
    width: '100%',
    maxWidth: 'calc(var(--space-40) * 3)',
    aspectRatio: '16 / 9',
    objectFit: 'cover',
    borderRadius: 'var(--radius-8)'
  },
  button: { minHeight: 'calc(var(--space-40) + var(--space-4))', width: 'fit-content' },
  status: { margin: 0, color: 'var(--color-muted)' },
  error: { margin: 0, color: 'var(--color-red)' }
});

export function VenuePhotoUpload({ communityId, venueId, photoUrl, onUploaded }: Props) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'validation' | 'upload' | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
  );
  function choose(fileSelection?: File) {
    setError(null);
    setUploaded(false);
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    if (!fileSelection) return;
    try {
      validateVenuePhotoFile(fileSelection);
      setFile(fileSelection);
      setPreview(URL.createObjectURL(fileSelection));
    } catch {
      setError('validation');
    }
  }
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const client = getBrowserClient();
      const { data, error: authError } = await client.auth.getClaims();
      const userId = data?.claims?.sub;
      if (authError || typeof userId !== 'string') throw new Error('UNAUTHENTICATED');
      const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
      const key = `${communityId}/${venueId}/${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await client.storage
        .from(COMMUNITY_VENUE_PHOTO_BUCKET)
        .upload(key, file, { upsert: false, contentType: file.type });
      if (uploadError) throw uploadError;
      if (!active.current) return;
      await finalizeCommunityVenuePhoto({
        data: { community_id: communityId, venue_id: venueId, object_key: key }
      });
      if (!active.current) return;
      setFile(null);
      setPreview(null);
      setUploaded(true);
      onUploaded();
    } catch {
      setError('upload');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div {...stylex.props(styles.root)}>
      {(preview || photoUrl) && (
        <img
          src={preview ?? photoUrl ?? undefined}
          alt={t('communityAdmin.venue.photo.previewAlt')}
          {...stylex.props(styles.preview)}
        />
      )}
      <label htmlFor={`venue-photo-${venueId}`}>{t('communityAdmin.venue.photo.label')}</label>
      <input
        id={`venue-photo-${venueId}`}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={busy}
        aria-describedby={`venue-photo-help-${venueId}`}
        onChange={(event) => choose(event.target.files?.[0])}
      />
      <p id={`venue-photo-help-${venueId}`} {...stylex.props(styles.status)}>
        {t('communityAdmin.venue.photo.help')}
      </p>
      {file && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void upload()}
            {...stylex.props(styles.button)}
          >
            {busy
              ? t('communityAdmin.venue.photo.uploading')
              : error === 'upload'
                ? t('communityAdmin.venue.photo.retry')
                : t('communityAdmin.venue.photo.upload')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => choose()}
            {...stylex.props(styles.button)}
          >
            {t('communityAdmin.venue.photo.clearSelection')}
          </button>
        </>
      )}
      {busy && (
        <output {...stylex.props(styles.status)}>
          {t('communityAdmin.venue.photo.uploading')}
        </output>
      )}
      {uploaded && (
        <output {...stylex.props(styles.status)}>{t('communityAdmin.venue.photo.uploaded')}</output>
      )}
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {t(
            error === 'validation'
              ? 'communityAdmin.venue.photo.invalid'
              : 'communityAdmin.venue.photo.failed'
          )}
        </p>
      )}
    </div>
  );
}
