import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  cancelMyLevelReview,
  listLevelReviewQueue,
  listMyLevelReviews,
  markLevelReviewUnderReview,
  readLevelReviewAccess,
  readLevelReviewAdminDetail,
  readMyLevelReview,
  resolveLevelReview,
  submitLevelReview
} from './level-review.server';
import {
  validateLevelReviewList,
  validateLevelReviewQueue,
  validateLevelReviewRequest,
  validateResolveLevelReview,
  validateSubmitLevelReview
} from './level-review-validators';

// Each handler authenticates through requireAuthenticatedClient (getClaims + private,
// no-store) and calls the database with the request-local client; the database decides
// who may do or see what. Platform Admin is never inferred from claims or metadata.

export const getLevelReviewAccess = createServerFn({ method: 'GET' }).handler(async () => {
  const { client } = await requireAuthenticatedClient();
  return readLevelReviewAccess(client);
});

export const submitLevelReviewRequest = createServerFn({ method: 'POST' })
  .validator(validateSubmitLevelReview)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    return submitLevelReview(client, data);
  });

export const listMyLevelReviewRequests = createServerFn({ method: 'GET' })
  .validator(validateLevelReviewList)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    return listMyLevelReviews(client, data);
  });

export const getMyLevelReviewRequest = createServerFn({ method: 'GET' })
  .validator(validateLevelReviewRequest)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    return readMyLevelReview(client, data);
  });

export const cancelLevelReviewRequest = createServerFn({ method: 'POST' })
  .validator(validateLevelReviewRequest)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    return cancelMyLevelReview(client, data);
  });

export const listLevelReviewQueueRequests = createServerFn({ method: 'GET' })
  .validator(validateLevelReviewQueue)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    return listLevelReviewQueue(client, data);
  });

export const getLevelReviewAdminDetail = createServerFn({ method: 'GET' })
  .validator(validateLevelReviewRequest)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    return readLevelReviewAdminDetail(client, data);
  });

export const markLevelReviewRequestUnderReview = createServerFn({ method: 'POST' })
  .validator(validateLevelReviewRequest)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    return markLevelReviewUnderReview(client, data);
  });

export const resolveLevelReviewRequest = createServerFn({ method: 'POST' })
  .validator(validateResolveLevelReview)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    return resolveLevelReview(client, data);
  });
