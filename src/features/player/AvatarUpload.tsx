import * as stylex from '@stylexjs/stylex';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadOwnerAvatar } from './avatar-upload';
import { completeAvatarUpload } from './player.functions';
import { playerInitials } from './player-initials';
import { Button } from '../../components/ui/Button';
import { validateAvatarFile } from './player.validators';
import { avatarRow as a, chips } from './profile-edit.styles';

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
    if (!preview) return undefined;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  function chooseFile(selected: File | undefined) {
    setError('');
    setFile(null);
    setPreview(null);
    if (!selected) return;
    try {
      validateAvatarFile({ type: selected.type, size: selected.size });
      setFile(selected);
      setPreview(URL.createObjectURL(selected));
    } catch {
      setError('profile.avatarInvalid');
    }
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const objectKey = await uploadOwnerAvatar(file);
      const profile = await completeAvatarUpload({ data: { objectKey } });
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

  const uploadId = useId();
  return (
    <div {...stylex.props(a.row)}>
      {preview || avatarUrl ? (
        <img
          src={preview ?? avatarUrl ?? undefined}
          alt={t('profile.avatarAlt', { name })}
          {...stylex.props(a.avatar)}
        />
      ) : (
        <span {...stylex.props(a.avatar)}>
          <span aria-hidden="true">{initials}</span>
          <span {...stylex.props(chips.srOnly)}>{t('profile.avatarAlt', { name })}</span>
        </span>
      )}
      <div {...stylex.props(a.body)}>
        <label htmlFor={uploadId} {...stylex.props(a.change)}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...stylex.props(a.icon)}
          >
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
          {t('profile.changePhoto')}
          <input
            id={uploadId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            aria-describedby={error ? 'avatar-error' : 'avatar-help'}
            onChange={(event) => chooseFile(event.target.files?.[0])}
            {...stylex.props(a.file)}
          />
        </label>
        <p id="avatar-help" {...stylex.props(a.help)}>
          {t('profile.avatarHelp')}
        </p>
        {file && (
          <Button variant="secondary" onClick={() => void upload()} disabled={uploading}>
            {uploading ? t('profile.avatarUploading') : t('profile.avatarUploadAction')}
          </Button>
        )}
        {uploading && <output {...stylex.props(a.help)}>{t('profile.avatarUploading')}</output>}
        {error && (
          <p id="avatar-error" role="alert" {...stylex.props(a.error)}>
            {t(error)}
          </p>
        )}
      </div>
    </div>
  );
}
