import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { signUnattachedMatchPhotoFn } from './match-photo.functions';
import { createMatchStyles as s } from './create-match.styles';
import type { MatchDraft } from './match-contracts';
import { formatMatchLeaguePeriod, type MatchCompetitionResolution } from './match-league-selection';

type ReviewValue = MatchDraft & { timezone: string; cutoffInstant: string };
export function MatchReview({
  value,
  photo,
  count,
  competition
}: {
  value: ReviewValue;
  photo: string;
  count: number;
  competition: MatchCompetitionResolution;
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
  const competitionText =
    competition.competition === 'ranked' && competition.league
      ? `${t('matches.competition.ranked')} · ${competition.league.name} · ${formatMatchLeaguePeriod(competition.league, i18n.language)}`
      : t('matches.competition.unranked');
  const rows: [string, string][] = [
    [t('matchCreate.reviewRows.when'), `${value.date} · ${value.startTime} · ${value.timezone}`],
    [t('matchCreate.fields.cutoff'), value.cutoffInstant || t('matchCreate.helpers.defaultCutoff')],
    [t('matchCreate.reviewRows.where'), value.venueName],
    [t('matchCreate.fields.type'), t(`matches.type.${value.type}`)],
    ...(value.type === 'competitive'
      ? [[t('matchCreate.competition.legend'), competitionText] as [string, string]]
      : []),
    [t('matchCreate.fields.visibility'), t(`matches.visibility.${value.visibility}`)],
    [
      t('matchCreate.reviewRows.level'),
      !value.levelRestriction
        ? t('matches.card.noLevelRestriction')
        : `${value.minLevel}–${value.maxLevel}`
    ],
    ...(cost ? [[t('matchCreate.fields.price'), cost] as [string, string]] : []),
    [t('matchCreate.reviewRows.teams'), t(`matches.teamMode.${value.teamMode}`)],
    ...(value.courtBooked
      ? [[t('matchCreate.fields.courtBooked'), t('matchCreate.reviewRows.yes')] as [string, string]]
      : []),
    ...(value.paymentNote
      ? [[t('matchCreate.fields.paymentNote'), value.paymentNote] as [string, string]]
      : []),
    ...(value.maximumRegistrations
      ? [
          [t('matchCreate.fields.maximumRegistrations'), value.maximumRegistrations] as [
            string,
            string
          ]
        ]
      : []),
    [t('matchCreate.invitees.selected'), String(count)]
  ];
  return (
    <section {...stylex.props(s.fields)}>
      <h2 {...stylex.props(s.heading)}>{t('matchCreate.readyTitle')}</h2>
      <dl {...stylex.props(s.list)}>
        {rows.map(([label, text]) => (
          <div key={label} {...stylex.props(s.reviewRow)}>
            <dt {...stylex.props(s.reviewKey)}>{label}</dt>
            <dd {...stylex.props(s.reviewValue)}>{text}</dd>
          </div>
        ))}
      </dl>
      <p {...stylex.props(s.muted)}>{t('matchCreate.informationalOnly')}</p>
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
      {previewFailed === photo && (
        <p role="alert" {...stylex.props(s.formMessage)}>
          {t('matchCreate.photo.unavailable')}
        </p>
      )}
    </section>
  );
}
