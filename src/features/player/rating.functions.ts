import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  readMatchEventRatingChanges,
  readRatingGroupExplanation,
  readRatingHistory,
  readRatingProgress,
  readRatingSummary
} from './rating.server';
import {
  validateRatingEventChanges,
  validateRatingExplanation,
  validateRatingHistory,
  validateRatingProgress
} from './rating-validators';

// Each handler authenticates through requireAuthenticatedClient (getClaims + private,
// no-store) and reads with the request-local client; the database decides who may see what.

export const getMyRatingSummary = createServerFn({ method: 'GET' }).handler(async () => {
  const { client } = await requireAuthenticatedClient();
  return readRatingSummary(client);
});

export const getMyRatingHistory = createServerFn({ method: 'GET' })
  .validator(validateRatingHistory)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    return readRatingHistory(client, data);
  });

export const getMyRatingProgress = createServerFn({ method: 'GET' })
  .validator(validateRatingProgress)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    return readRatingProgress(client, data);
  });

export const getRatingGroupExplanation = createServerFn({ method: 'GET' })
  .validator(validateRatingExplanation)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    return readRatingGroupExplanation(client, data);
  });

export const getMatchEventRatingChanges = createServerFn({ method: 'GET' })
  .validator(validateRatingEventChanges)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    return readMatchEventRatingChanges(client, data);
  });
