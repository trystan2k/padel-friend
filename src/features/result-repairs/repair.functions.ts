import { createServerFn } from '@tanstack/react-start';
import { setResponseHeader } from '@tanstack/react-start/server';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  parseResultRepairAttempts,
  parseResultRepairClaim,
  parseResultRepairDiagnostics,
  parseResultRepairExecution,
  resultRepairError,
  type ResultRepairAttempt,
  type ResultRepairDiagnostics,
  type ResultRepairResponse,
  type ResultRepairRetryOutcome
} from './repair-model';
import {
  validateResultAdminCapability,
  validateResultRepairJobId,
  validateResultRepairScope
} from './repair.validators';

async function repairClient() {
  setResponseHeader('Cache-Control', 'private, no-store');
  const { client } = await requireAuthenticatedClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub || data.claims.is_anonymous === true)
    throw new Error('UNAUTHENTICATED');
  return client;
}

export const getResultRepairDiagnostics = createServerFn({ method: 'GET' })
  .validator(validateResultRepairScope)
  .handler(async ({ data }): Promise<ResultRepairResponse<ResultRepairDiagnostics>> => {
    const client = await repairClient();
    const { data: result, error } = await client.rpc('get_result_repair_diagnostics', {
      p_community_id: data.community_id ?? undefined
    });
    if (error) return resultRepairError(error);
    const value = parseResultRepairDiagnostics(result);
    return value ? { status: 'ok', value } : { status: 'error', code: 'unavailable' };
  });

export const getResultRepairAttempts = createServerFn({ method: 'GET' })
  .validator(validateResultRepairJobId)
  .handler(async ({ data }): Promise<ResultRepairResponse<ResultRepairAttempt[]>> => {
    const client = await repairClient();
    const { data: result, error } = await client.rpc('get_result_repair_attempts', {
      p_job_id: data.job_id
    });
    if (error) return resultRepairError(error);
    const value = parseResultRepairAttempts(result);
    return value ? { status: 'ok', value } : { status: 'error', code: 'unavailable' };
  });

// Authority is the RPC's: it re-reads the caller's role on both steps, so a hidden or stale
// button never grants anything. Claim and execution are separate transactions by design: a
// caller that dies between them leaves a committed claim the processor reclaims after its lease.
export const retryResultRepair = createServerFn({ method: 'POST' })
  .validator(validateResultRepairJobId)
  .handler(async ({ data }): Promise<ResultRepairResponse<ResultRepairRetryOutcome>> => {
    const client = await repairClient();
    const { data: claimed, error } = await client.rpc('retry_result_repair', {
      p_job_id: data.job_id
    });
    if (error) return resultRepairError(error);
    const claim = parseResultRepairClaim(claimed);
    if (!claim) return { status: 'error', code: 'unavailable' };
    if (!claim.claimed) return { status: 'ok', value: { outcome: 'busy', job: null } };
    if (claim.job.job_id !== data.job_id) return { status: 'error', code: 'unavailable' };
    const { data: executed, error: executeError } = await client.rpc(
      'execute_claimed_result_repair',
      { p_job_id: data.job_id, p_attempt_number: claim.attempt_number }
    );
    if (executeError) return resultRepairError(executeError);
    const execution = parseResultRepairExecution(executed);
    return execution && execution.job.job_id === data.job_id
      ? { status: 'ok', value: execution }
      : { status: 'error', code: 'unavailable' };
  });

/** Display gate only: the guarded RPCs authorize every command independently. */
export const getResultAdminCapability = createServerFn({ method: 'GET' })
  .validator(validateResultAdminCapability)
  .handler(async ({ data }): Promise<boolean> => {
    const client = await repairClient();
    const { data: isAdmin, error } = await client.rpc('is_community_admin', {
      p_community_id: data.community_id
    });
    return !error && isAdmin;
  });
