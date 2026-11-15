export interface ServerFunctionErrorFinding {
  file: string;
  line: number;
  rule:
    | 'raw-throw'
    | 'error-message-passthrough'
    | 'dynamic-error'
    | 'raw-cause'
    | 'promise-reject';
}

export function scanServerFunctionErrors(
  sources: Array<{ file: string; text: string }>
): ServerFunctionErrorFinding[];
