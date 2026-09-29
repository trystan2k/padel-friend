import { useEffect } from 'react';

export function DevStyleXInject() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      // @ts-expect-error virtual module provided by @stylexjs/unplugin during dev
      void import('virtual:stylex:runtime');
    }
  }, []);

  if (!import.meta.env.DEV) return null;
  return <link rel="stylesheet" href="/virtual:stylex.css" />;
}
