import { Plugin } from '@opencode/plugin';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

function errnoCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = error.code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

const reviewers = new Set([
  'subagents/code-review-specialist',
  'subagents/architecture-review-specialist',
  'subagents/ux-ui-reviewer-specialist',
  'subagents/qa-gate-specialist',
]);
const RESTRICTED_READ_SHELL = new Set([
  'subagents/code-review-specialist',
  'subagents/architecture-review-specialist',
  'subagents/ux-ui-reviewer-specialist',
  'subagents/qa-gate-specialist',
  'subagents/development-log-specialist',
]);
const delegates = new Set([
  'subagents/project-manager-specialist', 'subagents/git-specialist',
  'subagents/execution-planner-specialist', 'subagents/implementation-specialist',
  'subagents/bug-fixer-specialist', 'subagents/testing-automation-specialist',
  'subagents/qa-gate-specialist', 'subagents/code-review-specialist',
  'subagents/architecture-review-specialist', 'subagents/ux-ui-reviewer-specialist',
  'subagents/development-log-specialist',
]);

export default Plugin.define({
  id: 'delivery-harness',
  async setup(ctx) {
    const root = await realpath(ctx.location.directory);
    const correlations = new Map<string, string>();
    const started = new Map<string, number>();
    let queue = Promise.resolve();
    let queued = 0;
    let warned = false;

    async function openTelemetry(write: boolean) {
      const parent = join(root, '.opencode');
      if (await realpath(parent) !== parent) throw new Error('unsafe directory');
      const directory = join(parent, 'state');
      if (write) {
        try { await mkdir(directory, { mode: 0o700 }); } catch (error) {
          if (errnoCode(error) !== 'EEXIST') throw error;
        }
      }
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error('unsafe state');
      const flags = write ? constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT : constants.O_RDONLY;
      const file = await open(join(directory, 'delivery-telemetry.jsonl'), flags | constants.O_NOFOLLOW, 0o600);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new Error('unsafe file');
        return { file, stat };
      } catch (error) {
        await file.close();
        throw error;
      }
    }
    async function append(record: object) {
      try {
        const { file } = await openTelemetry(true);
        try { await file.writeFile(`${JSON.stringify(record)}\n`); } finally { await file.close(); }
      } catch {
        if (!warned) { warned = true; console.warn('Delivery telemetry unavailable.'); }
      }
    }
    function correlationFor(sessionID: string | undefined) {
      if (!sessionID?.trim()) return randomUUID();
      const existing = correlations.get(sessionID);
      if (existing) return existing;
      if (correlations.size >= 512) correlations.delete(correlations.keys().next().value!);
      const correlation = randomUUID();
      correlations.set(sessionID, correlation);
      return correlation;
    }
    function emit(sessionID: string | undefined, record: object) {
      if (queued >= 512) return;
      queued++;
      queue = queue.then(() => append({ version: 1, timestamp: new Date().toISOString(), correlation: correlationFor(sessionID), ...record })).finally(() => { queued--; });
    }
    const title = await ctx.session.hook('title', (event) => {
      const message = event.messages.find((item) => item.role === 'user');
      const text = message?.content.filter((part) => part.type === 'text').map((part) => part.text).join(' ') ?? '';
      const line = (text.trimStart().split(/\r?\n/, 1)[0] ?? '').replace(/^\s*#+\s*/, '').replace(/`/g, '').trim().replace(/\s+/g, ' ');
      event.result = line ? (line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line) : 'Delivery session';
    });
    const context = await ctx.session.hook('context', (event) => {
      if (!reviewers.has(event.agent)) return;
      delete event.tools.write;
      delete event.tools.edit;
    });
    const tools = await ctx.tool.transform((editor) => {
      editor.namespace({ name: 'harness', description: 'PadelFriend delivery harness metadata' });
      editor.add({
        name: 'context_bundle',
        description: 'Return branch, changed file metadata and skill IDs.',
        input: { type: 'object', properties: {}, additionalProperties: false },
        options: { namespace: 'harness', codemode: false, permission: 'harness_context_bundle' },
        async execute(_input, toolCtx) {
          if (toolCtx.agent !== 'delivery-orchestrator' && !delegates.has(toolCtx.agent)) return { content: 'Delivery harness: context bundle access denied.' };
          await ctx.permission.assert({ sessionID: toolCtx.sessionID, agent: toolCtx.agent, source: { type: 'tool', messageID: toolCtx.messageID, id: toolCtx.id }, action: 'harness_context_bundle', resources: ['*'] });
          try {
            const options = { signal: toolCtx.signal };
            const [vcs, fileStatus, skills] = await Promise.all([
              ctx.vcs.get(undefined, options), ctx.vcs.status(undefined, options), ctx.skill.list(undefined, options),
            ]);
            return { content: JSON.stringify({ branch: vcs.data.branch.current ?? null, changedFiles: fileStatus.data.map(({ file, status: changedStatus }) => ({ path: file, status: changedStatus })), skills: skills.data.map((skill) => skill.id), generatedAt: new Date().toISOString() }) };
          } catch {
            return { content: JSON.stringify({ available: false, error: 'Context bundle unavailable.' }) };
          }
        },
      });
      editor.add({
        name: 'telemetry_summary',
        description: 'Return aggregate delivery telemetry without raw records.',
        input: { type: 'object', properties: {}, additionalProperties: false },
        options: { namespace: 'harness', codemode: false, permission: 'harness_telemetry_summary' },
        async execute(_input, toolCtx) {
          if (toolCtx.agent !== 'delivery-orchestrator' && toolCtx.agent !== 'subagents/qa-gate-specialist') return { content: 'Delivery harness: telemetry summary access denied.' };
          await ctx.permission.assert({ sessionID: toolCtx.sessionID, agent: toolCtx.agent, source: { type: 'tool', messageID: toolCtx.messageID, id: toolCtx.id }, action: 'harness_telemetry_summary', resources: ['*'] });
          try {
            toolCtx.signal.throwIfAborted();
            const { file, stat } = await openTelemetry(false);
            const categories = new Set(['read', 'edit', 'write', 'patch', 'shell', 'subagent', 'other']);
            const outcomes = new Set(['success', 'failure', 'blocked']);
            const byCategory: Record<string, { count: number; elapsedTotalMs: number; elapsedCount: number; elapsedAvgMs: number }> = {};
            const byOutcome: Record<string, number> = {};
            let total = 0;
            let scannedLines = 0;
            let scannedBytes = 0;
            const chunk = Buffer.alloc(16 * 1024);
            const tailStart = Math.max(0, stat.size - 32 * 1024 * 1024);
            let start = tailStart;
            let end = 0;
            let boundaries = 0;
            let aligned = false;
            let truncated = tailStart > 0;
            let discard = false;
            let lineLength = 0;
            const lineBuffer = Buffer.alloc(64 * 1024);
            const aggregate = () => {
              if (!lineLength) return;
              const record: unknown = JSON.parse(lineBuffer.subarray(0, lineLength).toString('utf8'));
              if (!record || typeof record !== 'object') throw new Error('invalid telemetry');
              const category = 'category' in record ? record.category : undefined;
              const outcome = 'outcome' in record ? record.outcome : undefined;
              const elapsedMs = 'elapsedMs' in record ? record.elapsedMs : undefined;
              const cat = typeof category === 'string' && categories.has(category) ? category : 'other';
              const result = typeof outcome === 'string' && outcomes.has(outcome) ? outcome : 'other';
              const group = byCategory[cat] ??= { count: 0, elapsedTotalMs: 0, elapsedCount: 0, elapsedAvgMs: 0 };
              group.count++;
              if (typeof elapsedMs === 'number' && Number.isFinite(elapsedMs) && elapsedMs >= 0) {
                group.elapsedTotalMs += elapsedMs;
                group.elapsedCount++;
                group.elapsedAvgMs = group.elapsedTotalMs / group.elapsedCount;
              }
              byOutcome[result] = (byOutcome[result] ?? 0) + 1;
              total++;
            };
            try {
              let cursor = stat.size;
              while (cursor > tailStart && boundaries <= 100_000) {
                toolCtx.signal.throwIfAborted();
                const size = Math.min(chunk.length, cursor - tailStart);
                cursor -= size;
                const { bytesRead } = await file.read(chunk, 0, size, cursor);
                if (bytesRead !== size) throw new Error('incomplete telemetry');
                for (let i = size - 1; i >= 0; i--) {
                  if (chunk[i] !== 10) continue;
                  boundaries++;
                  if (boundaries === 1) end = cursor + i + 1;
                  if (boundaries === 100_001) {
                    start = cursor + i + 1;
                    aligned = true;
                    truncated = true;
                    break;
                  }
                }
              }
              if (end < stat.size) truncated = true;
              if (!end) start = 0;
              if (start > 0 && !aligned) {
                const { bytesRead } = await file.read(chunk, 0, 1, start - 1);
                if (bytesRead !== 1) throw new Error('incomplete telemetry');
                discard = chunk[0] !== 10;
              }
              let position = start;
              while (position < end) {
                toolCtx.signal.throwIfAborted();
                const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, end - position), position);
                if (!bytesRead) throw new Error('incomplete telemetry');
                for (let i = 0; i < bytesRead; i++) {
                  const byte = chunk[i];
                  scannedBytes++;
                  if (byte === 10) {
                    if (!discard) { aggregate(); scannedLines++; }
                    else if (position + i >= start && scannedLines === 0) start = position + i + 1;
                    discard = false;
                    lineLength = 0;
                  } else if (!discard) {
                    if (lineLength === lineBuffer.length) { discard = true; truncated = true; lineLength = 0; }
                    else lineBuffer[lineLength++] = byte;
                  }
                }
                position += bytesRead;
              }
              if (lineLength || discard) truncated = true;
            } finally { await file.close(); }
            return { content: JSON.stringify({ available: true, total, byCategory, byOutcome, truncated, scannedLines, scannedBytes, window: { lines: scannedLines, fromByte: start, truncated } }) };
          } catch (error) {
            const missing = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
            return { content: JSON.stringify(missing ? { available: false } : { available: false, error: 'Telemetry summary unavailable.' }) };
          }
        },
      });
    });
    const before = await ctx.tool.hook('execute.before', (event) => {
      if (started.size < 512) started.set(event.id, Date.now());
    });
    const after = await ctx.tool.hook('execute.after', (event) => {
      const start = started.get(event.id);
      started.delete(event.id);
      const category = ['read', 'edit', 'write', 'patch', 'shell', 'subagent'].includes(event.tool) ? event.tool : 'other';
      emit(event.sessionID, { event: 'tool', category, outcome: event.status === 'completed' ? 'success' : 'failure', ...(start === undefined ? {} : { elapsedMs: Math.max(0, Date.now() - start) }) });
    });
    const executeGuard = await ctx.tool.hook('execute.before', async (event) => {
      if (event.tool !== 'shell') return;
      const command = typeof event.input === 'object' && event.input !== null && 'command' in event.input && typeof event.input.command === 'string'
        ? event.input.command
        : '';
      if (RESTRICTED_READ_SHELL.has(event.agent ?? '') && command.trim().startsWith('git ') && ['--output', '--ext-diff', '--textconv'].some((option) => command.includes(option))) {
        emit(event.sessionID, { event: 'tool', category: 'shell', outcome: 'blocked' });
        throw new Error('Delivery harness: read-only Git role; use --stat or --name-only forms or request scope via coordinator.');
      }
      if (event.agent !== 'delivery-orchestrator') return;
      // Not shell parsing or containment: quoted redirection characters may false-positive
      // (e.g. git log --grep='a > b'); route such commands to specialists.
      // Unknown commands pass through to native policy.
      const mutating = />>?\s*[^\s]+|(?:^|[\s;|&])tee\s+|(?:^|[\s;|&])sed\s+-i|(?:^|[\s;|&])(?:rm|mv|cp)\s+(?!\/|~)[^\s]+|(?:^|[\s;|&])git\s+(?:commit\b|checkout\s+--(?:\s|$)|reset\s+--hard\b|clean\b)/m.test(command);
      if (mutating) {
        emit(event.sessionID, { event: 'tool', category: 'shell', outcome: 'blocked' });
        throw new Error('Delivery harness: use sanctioned file tools or git-specialist for repository mutations.');
      }
    });
    const guard = await ctx.permission.hook('evaluate', async (event) => {
      const agent = event.agent?.trim() ?? '';
      const coveredEdit = event.action === 'edit' && (reviewers.has(agent) || (await Promise.all(event.resources.map(async (path) => {
        try {
          if (typeof path !== 'string' || !path.trim()) return true;
          let existingPath = resolve(root, path);
          const suffix: string[] = [];
          while (true) {
            try {
              existingPath = await realpath(existingPath);
              break;
            } catch (error) {
              const code = errnoCode(error);
              if (code !== 'ENOENT') return true;
              try {
                await lstat(existingPath);
                return true;
              } catch (statError) {
                if (errnoCode(statError) !== 'ENOENT') return true;
              }
              const parent = dirname(existingPath);
              if (parent === existingPath) return true;
              suffix.unshift(existingPath.slice(parent.length + 1));
              existingPath = parent;
            }
          }
          const canonicalTarget = resolve(existingPath, ...suffix);
          const target = relative(root, canonicalTarget);
          if (!target || target === '..' || target.startsWith(`..${sep}`) || isAbsolute(target)) return true;
          const normalized = target.split(sep).join('/');
          if (normalized === '.agents/skills' || normalized.startsWith('.agents/skills/')) return true;
          if (agent === 'subagents/execution-planner-specialist') return !normalized.startsWith('docs/plan/');
          if (agent === 'subagents/development-log-specialist') return !normalized.startsWith('docs/development-logs/');
          return false;
        } catch {
          return true;
        }
      }))).some(Boolean));
      const protectedEdit = event.action === 'edit' && (!agent || !event.resources.length || coveredEdit);
      const unsupportedDelegation = event.action === 'subagent' && (!agent || !event.resources.length || event.resources.some((target) =>
        !delegates.has(target) || agent.startsWith('subagents/'),
      ));
      if (protectedEdit || unsupportedDelegation) {
        event.effect = 'deny';
        event.message = 'Delivery harness: protected write or unresolvable edit target.';
      }
    });
    return async () => { await title.dispose(); await context.dispose(); await tools.dispose(); await before.dispose(); await after.dispose(); await executeGuard.dispose(); await guard.dispose(); await queue; };
  },
});
