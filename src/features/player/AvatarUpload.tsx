import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBrowserClient } from '../../lib/supabase/client';
import { completeAvatarUpload } from './player.functions';
import { playerInitials } from './player-initials';
import { validateAvatarFile } from './player.validators';
import { ui } from './player-ui.styles';

type Props = {
  name: string;
  avatarUrl: string | null;
  onUploaded: (profile: Awaited<ReturnType<typeof completeAvatarUpload>>) => void;
};

export function AvatarUpload({ name, avatarUrl, onUploaded }: Props) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const initials = playerInitials(name);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function chooseFile(selected: File | undefined) {
    setError('');
    setFile(null);
    setPreview(null);
    if (!selected) return;
    try {
      validateAvatarFile({ type: selected.type, size: selected.size });
      setFile(selected);
    } catch {
      setError('profile.avatarInvalid');
    }
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError('');
    const client = getBrowserClient();
    try {
      const { data: claims, error: authError } = await client.auth.getClaims();
      if (authError || !claims?.claims?.sub) throw new Error('UNAUTHENTICATED');
      const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
      const key = `${claims.claims.sub}/${crypto.randomUUID()}.${ext}`;
      const { data, error: uploadError } = await client.storage
        .from('player-avatars')
        .upload(key, file, { upsert: false, contentType: file.type });
      if (uploadError) throw uploadError;
      const profile = await completeAvatarUpload({ data: { objectKey: data.path } });
      onUploaded(profile);
      setFile(null);
      setPreview(null);
    } catch (cause) {
      // Keep uploaded objects on failure; a later GC task will retire unused keys.
      if (cause instanceof Error && cause.message === 'UNAUTHENTICATED') {
        window.location.assign('/login?next=/dashboard');
        return;
      }
      setError('profile.avatarFailed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div {...stylex.props(ui.stack)}>
      {preview || avatarUrl ? (
        <img
          src={preview ?? avatarUrl ?? undefined}
          alt={t('profile.avatarAlt', { name })}
          {...stylex.props(ui.avatar)}
        />
      ) : (
        <span {...stylex.props(ui.avatar)}>
          <span aria-hidden="true">{initials}</span>
          <span {...stylex.props(ui.srOnly)}>{t('profile.avatarAlt', { name })}</span>
        </span>
      )}
      <label htmlFor="profile-avatar" {...stylex.props(ui.label)}>
        {t('profile.avatar')}
      </label>
      <input
        id="profile-avatar"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={uploading}
        aria-describedby={error ? 'avatar-error' : 'avatar-help'}
        onChange={(event) => chooseFile(event.target.files?.[0])}
        {...stylex.props(ui.input)}
      />
      <p id="avatar-help" {...stylex.props(ui.muted)}>
        {t('profile.avatarHelp')}
      </p>
      {file && (
        <button
          type="button"
          onClick={() => void upload()}
          disabled={uploading}
          {...stylex.props(ui.button)}
        >
          {uploading ? t('profile.avatarUploading') : t('profile.avatarUploadAction')}
        </button>
      )}
      {uploading && <output {...stylex.props(ui.muted)}>{t('profile.avatarUploading')}</output>}
      {error && (
        <p id="avatar-error" role="alert" {...stylex.props(ui.error)}>
          {t(error)}
        </p>
      )}
    </div>
  );
}
