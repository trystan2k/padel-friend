export interface ClientSecretFinding {
  file: string;
  rule:
    | 'service-role-env-name'
    | 'secret-key-prefix'
    | 'service-role-jwt'
    | 'secret-value'
    | 'admin-client-import-boundary';
}

export function scanClientSecrets(options: {
  clientDir: string;
  sourceDir: string;
  secrets?: Array<string | undefined>;
}): Promise<ClientSecretFinding[]>;
