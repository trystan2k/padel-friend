import { execFileSync } from 'node:child_process';

const port = Number(process.argv[2] ?? 4173);

function listeningPids() {
  try {
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function kill(pid, signal) {
  try {
    process.kill(Number(pid), signal);
    return true;
  } catch {
    return false;
  }
}

// Best-effort: free a leftover listener so Playwright can start a fresh preview.
// On platforms without `lsof` (or with a free port) this is a no-op.
const pids = listeningPids();
for (const pid of pids) {
  if (kill(pid, 'SIGTERM')) {
    process.stderr.write(`[free-port] SIGTERM ${pid} on :${port}\n`);
  }
}

if (pids.length > 0) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  for (const pid of listeningPids()) {
    if (kill(pid, 'SIGKILL')) {
      process.stderr.write(`[free-port] SIGKILL ${pid} on :${port}\n`);
    }
  }
}
