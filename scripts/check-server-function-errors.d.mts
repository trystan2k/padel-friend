export interface ServerFunctionErrorFinding {
  file: string;
  line: number;
  rule: 'raw-throw' | 'error-message-passthrough' | 'raw-cause';
}

export function scanServerFunctionErrors(
  sources: Array<{ file: string; text: string }>
): ServerFunctionErrorFinding[];
