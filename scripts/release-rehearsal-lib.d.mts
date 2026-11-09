export const DEFAULT_CONTAINER: string;
export const RESTORE_PREFIX: string;
export const MIGRATION_PREFIX: string;
export type Docker = {
  container: string;
  exec(args: string[], options?: { input?: string | Buffer; encoding?: string }): string | Buffer;
  sql(database: string, statement: string): string;
  sqlFile(database: string, content: string): string | Buffer;
  admin(statement: string): string | Buffer;
  dump(database: string, args: string[]): Buffer;
  restore(database: string, data: Buffer, args?: string[]): string | Buffer;
};
export type SpawnLike = (
  command: string,
  args: string[],
  options?: Record<string, unknown>
) => { status: number | null; stdout?: string | Buffer; stderr?: string | Buffer; error?: Error };
export function assertLocalContainer(container: string): string;
export function assertDisposableDatabase(options: {
  name: string;
  prefix: string;
  source?: string;
  confirmation?: string;
}): string;
export function sha256(value: string | Buffer): string;
export function createDocker(options?: { container?: string; run?: SpawnLike }): Docker;
export function provisionDatabase(docker: Docker, name: string): void;
export function dropDatabase(docker: Docker, name: string): void;
export const SCHEMA_FINGERPRINT_SQL: string;
export function schemaFingerprint(docker: Docker, database: string): Record<string, unknown>;
export function diffFingerprints(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): string[];
