export interface NoticeResult {
  body: string;
  changed: boolean;
}

export function buildNoticeBody(body: string | null | undefined, tag: string): NoticeResult;

export function buildNoticeSummary(tag: string): string;

export interface NoticeOptions {
  env: { RELEASE_TAG?: string; GITHUB_REPOSITORY?: string; GITHUB_TOKEN?: string };
  fetch: (
    url: string,
    options?: Record<string, unknown>
  ) => Promise<{
    ok: boolean;
    status?: number;
    json(): Promise<unknown>;
  }>;
  out: { write(text: string): unknown };
  summary?: { write(text: string): unknown } | null;
}

export function postNotice(options: NoticeOptions): Promise<void>;
