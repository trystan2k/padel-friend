import type { ProofDb } from './verify-test-stack-isolation.mjs';
export const DUE_EVENT_COUNT: number;
export const PHOTO_BUCKET: string;
export const GUARD_TRIGGERS: string[][];
export class ProductFixtureError extends Error {}
export type ProductOwnership = {
  communityId: string;
  communityName: string;
  userIds: string[];
  eventIds: string[];
  proposalIds: string[];
  photoPaths: string[];
  uploadedPhotos: string[];
  committed: boolean;
};
export function productOwnership(id: string, userIds: string[]): ProductOwnership;
export function insertProductFixtures(
  db: ProofDb,
  owned: ProductOwnership,
  uploadPhoto: (name: string) => Promise<unknown>
): Promise<ProductOwnership>;
export function snapshotProduct(
  db: ProofDb,
  owned: ProductOwnership
): Promise<{
  communityPresent: boolean;
  eventCount: number;
  eventHash: string;
  photoCount: number;
  photoHash: string;
  versionCount: number;
  versionHash: string;
  proposalCount: number;
  proposalHash: string;
}>;
export function productAbsent(
  db: ProofDb,
  owned: ProductOwnership
): Promise<Record<string, boolean>>;
export function removeProductFixtures(
  db: ProofDb,
  owned: ProductOwnership,
  options?: { sleep?: (ms: number) => Promise<void> }
): Promise<void>;
