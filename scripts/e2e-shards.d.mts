export const VISUAL_GREP: string;
export const FUNCTIONAL_LANES: number;
export const DEFAULT_WEIGHT_SECONDS: number;
export const SPEC_WEIGHTS: Record<string, number>;
export const SERIAL_SPECS: string[];
export function listSpecs(dir?: string): string[];
export function isVisualFile(spec: string): boolean;
export function planGroups(
  specs: string[],
  weights?: Record<string, number>,
  count?: number
): { specs: string[]; seconds: number }[];
export function laneArgs(lane: string, specs?: string[]): string[];
