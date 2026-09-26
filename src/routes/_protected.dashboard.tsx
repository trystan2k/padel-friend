import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { addNote, listNotes } from '../features/notes/notes.functions';
import { getBrowserClient } from '../lib/supabase/client';

export const Route = createFileRoute('/_protected/dashboard')({
  loader: () => listNotes(),
  component: Dashboard
});

function Dashboard() {
  const { t } = useTranslation();
  const notes = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const body = new FormData(form).get('body');
      await addNote({ data: typeof body === 'string' ? body : '' });
      form.reset();
      await router.invalidate();
    } catch {
      setError(t('error'));
    }
  }
  return (
    <main>
      <h1>{t('dashboard')}</h1>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          {t('note')}
          <input name="body" required maxLength={500} />
        </label>
        <button type="submit">{t('add')}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {notes.length ? (
        <ul>
          {notes.map((note) => (
            <li key={note.id}>{note.body}</li>
          ))}
        </ul>
      ) : (
        <p>{t('empty')}</p>
      )}
      <button
        type="button"
        onClick={() =>
          void getBrowserClient()
            .auth.signOut()
            .then(() => {
              window.location.href = '/';
            })
        }
      >
        {t('signOut')}
      </button>
    </main>
  );
}
