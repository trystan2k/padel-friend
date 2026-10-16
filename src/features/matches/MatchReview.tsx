import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { createMatchStyles as s } from './create-match.styles';
export function MatchReview({ value, photo, count }: { value: any; photo: string; count: number }) {
  const { t, i18n } = useTranslation();
  const currency = ['BRL', 'USD', 'EUR'].includes(value.currency) ? value.currency : 'EUR';
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
      <p>
        {cost} {t('matchCreate.informationalOnly')}
      </p>
      {photo && <img src={photo} alt={t('matchCreate.fields.photo')} />}
      <p>{t(`matches.teamMode.${value.teamMode ?? 'POST_MATCH_TEAMS'}`)}</p>
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
