import { Link, createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StarterCard } from '../components/StarterCard';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  const { t } = useTranslation();
  return (
    <>
      <StarterCard />
      <nav>
        <Link to="/login">{t('signIn')}</Link>
      </nav>
    </>
  );
}
