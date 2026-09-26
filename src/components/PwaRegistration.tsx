import { useEffect } from 'react';

export function PwaRegistration() {
  useEffect(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js');
    }
  }, []);
  return null;
}
