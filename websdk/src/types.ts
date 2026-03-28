// Trustline Solana SDK Types

export type SolanaValidationMode = string | null;

export interface TrustlineInitOptions {
  clientId: string;
  apiUrl?: string;
  loginUri?: string;
}

export interface SolanaInstructionAccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface SolanaInstructionPayload {
  data: string;
  accounts: SolanaInstructionAccountMeta[];
}

export interface SolanaTransactionInstructionLike {
  data: Uint8Array | ArrayLike<number>;
  keys: Array<{
    pubkey: string | { toBase58(): string } | { toString(): string };
    isSigner: boolean;
    isWritable: boolean;
  }>;
}

export interface OpenSessionSolanaParams {
  chainId: string | number;
  subject: string;
  scope: string;
  protectedProgram: string;
  instruction: SolanaInstructionPayload | SolanaTransactionInstructionLike;
  validationMode?: SolanaValidationMode;
  approvalRequired?: boolean;
}

export interface OpenSessionSolanaSuccessResult {
  success?: boolean;
  sessionId: string;
  authRequired?: boolean;
  [key: string]: unknown;
}

export interface JsonRpcSuccessResponse<T> {
  jsonrpc: string;
  id: number;
  result: T;
}

export interface JsonRpcErrorResponse {
  jsonrpc: string;
  id: number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type OpenSessionSolanaResult =
  | JsonRpcSuccessResponse<OpenSessionSolanaSuccessResult>
  | JsonRpcErrorResponse;

export interface ValidateSolanaParams {
  sessionId: string;
}

export interface ValidateSolanaApprovedResult {
  status: 'approved';
  certId?: string;
  partialCert?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ValidateSolanaRejectedResult {
  status: 'rejected';
  reason?: string;
  [key: string]: unknown;
}

export interface ValidateSolanaApprovalRequiredResult {
  status: 'approval_required';
  [key: string]: unknown;
}

export type ValidateSolanaResultPayload =
  | ValidateSolanaApprovedResult
  | ValidateSolanaRejectedResult
  | ValidateSolanaApprovalRequiredResult
  | Record<string, unknown>;

export type ValidateSolanaResult =
  | JsonRpcSuccessResponse<ValidateSolanaResultPayload>
  | JsonRpcErrorResponse;

export interface SolanaValidateParams extends OpenSessionSolanaParams {
  jwt?: string;
}

export interface JWTAuthMessage {
  type: 'JWT_TOKEN';
  jwt: string;
}
