import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode
} from 'react';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import type { RefreshStatus } from '../lib/authoritative-refresh';
import { accessibilityStyles as s } from './accessibility.styles';

const RefreshFailures = createContext<((id: string, failed: boolean) => void) | null>(null);

/** One persistent live region for all mounted readers, not an announcement per poll. */
export function RefreshStatusProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [failures, setFailures] = useState<ReadonlySet<string>>(() => new Set());
  const report = useCallback((id: string, failed: boolean) => {
    setFailures((previous) => {
      if (previous.has(id) === failed) return previous;
      const next = new Set(previous);
      if (failed) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  return (
    <RefreshFailures value={report}>
      <output aria-live="polite" aria-atomic="true">
        {failures.size > 0 && <span {...stylex.props(s.notice)}>{t('accessibility.stale')}</span>}
      </output>
      {children}
    </RefreshFailures>
  );
}

/** Instance IDs avoid collisions when multiple readers share a domain scope. */
export function useRefreshFailure(status: RefreshStatus) {
  const report = useContext(RefreshFailures);
  const id = useId();
  const failed = status === 'stale';
  useEffect(() => {
    report?.(id, failed);
    return () => report?.(id, false);
  }, [report, id, failed]);
}
