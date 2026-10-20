import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { signUnattachedMatchPhotoFn } from './match-photo.functions';
import { createMatchStyles as s } from './create-match.styles';
import type { MatchDraft } from './match-contracts';

type ReviewValue = MatchDraft & { timezone: string; cutoffInstant: string };
export function MatchReview({
  value,
  photo,
  count
}: {
  value: ReviewValue;
  photo: string;
  count: number;
}) {
  const { t, i18n } = useTranslation();
  const [preview, setPreview] = useState<{ key: string; url: string } | null>(null);
  const [previewFailed, setPreviewFailed] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (photo)
      void signUnattachedMatchPhotoFn({ data: { object_key: photo } })
        .then((url) => {
          if (active) setPreview({ key: photo, url });
        })
        .catch(() => {
          if (active) setPreviewFailed(photo);
        });
    return () => {
      active = false;
    };
  }, [photo]);
  const currency = value.currency;
  const cost =
    value.price === '' || value.price == null
      ? ''
      : new Intl.NumberFormat(i18n.language, { style: 'currency', currency }).format(
          Number(value.price)
        );
  return (
    <section {...stylex.props(s.card)}>
      <h2>{t('matchCreate.review')}</h2>
      <p>{value.cutoffInstant || t('matchCreate.helpers.defaultCutoff')}</p>
      <div {...stylex.props(s.reviewFacts)}>
        <p>
          {value.date} · {value.startTime} · {value.timezone}
        </p>
        <p>{value.venueName}</p>
        <p>{t(`matches.type.${value.type}`)}</p>
        <p>{t(`matches.visibility.${value.visibility}`)}</p>
        <p>
          {!value.levelRestriction
            ? t('matches.card.noLevelRestriction')
            : `${value.minLevel}–${value.maxLevel}`}
        </p>
      </div>
      <p>
        {cost} {t('matchCreate.informationalOnly')}
      </p>
      {preview?.key === photo ? (
        <img
          {...stylex.props(s.photo)}
          src={preview.url}
          alt={t('matchCreate.fields.photo')}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.complete && image.naturalWidth > 0) image.dataset.decoded = 'true';
          }}
          onError={() => setPreviewFailed(photo)}
        />
      ) : null}
      {previewFailed === photo && <p role="alert">{t('matchCreate.photo.unavailable')}</p>}
      <p>{t(`matches.teamMode.${value.teamMode}`)}</p>
      {value.courtBooked && <p>{t('matchCreate.fields.courtBooked')}</p>}
      {value.paymentNote && <p>{value.paymentNote}</p>}
      {value.maximumRegistrations && (
        <p>
          {t('matchCreate.fields.maximumRegistrations')}: {value.maximumRegistrations}
        </p>
      )}
      <p>
        {t('matchCreate.invitees.selected')}: {count}
      </p>
    </section>
  );
}
