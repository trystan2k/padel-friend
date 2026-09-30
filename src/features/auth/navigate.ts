// Keep full-document navigation for Supabase's browser session cookies.
export function navigateAfterAuth(destination: string): void {
  window.location.assign(destination);
}
