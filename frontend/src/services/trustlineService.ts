import { PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, Transaction, TransactionInstruction } from '@solana/web3.js';
import { sha256 } from 'js-sha256';
import { trustline } from '@trustline.id/websdk-solana';
import {
  TRUSTLINE_GLOBAL_CONFIG_SEED,
  TRUSTLINE_PROTOCOL_CONFIG_SEED,
  TRUSTLINE_VALIDATION_ENGINE_PROGRAM_ID,
  VaultAccount,
} from '../lib/svs13';

const textEncoder = new TextEncoder();
const PROTECTED_INSTRUCTION_NAMES = [
  'initialize',
  'deposit',
  'mint',
  'withdraw',
  'redeem',
  'pause',
  'unpause',
  'transfer_authority',
  'set_trustline_config',
  'sync_total_assets',
  'add_adapter',
  'remove_adapter',
  'set_roles',
  'set_liquidity_adapter',
  'set_adapter_caps',
  'enable_adapter',
  'disable_adapter',
  'allocate',
  'deallocate',
  'initialize_fee_config',
  'update_fee_config',
  'initialize_cap_config',
  'update_cap_config',
  'initialize_lock_config',
  'update_lock_config',
  'initialize_access_config',
  'update_access_config',
] as const;

function discriminatorForInstruction(name: string): string {
  const bytes = Uint8Array.from(sha256.digest(`global:${name}`)).slice(0, 8);
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

const PROTECTED_DISCRIMINATORS = new Set(
  PROTECTED_INSTRUCTION_NAMES.map((name) => discriminatorForInstruction(name))
);

function getInstructionDiscriminator(instruction: TransactionInstruction): string {
  return Array.from(instruction.data.slice(0, 8))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function deriveGlobalConfigPda(engineProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode(TRUSTLINE_GLOBAL_CONFIG_SEED)],
    engineProgram
  )[0];
}

function deriveProtocolConfigPda(engineProgram: PublicKey, protectedProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode(TRUSTLINE_PROTOCOL_CONFIG_SEED), protectedProgram.toBuffer()],
    engineProgram
  )[0];
}

function parseApprovalAddress(validationResult: unknown): PublicKey {
  if (!validationResult || typeof validationResult !== 'object') {
    throw new Error('Trustline: validateSolana returned an invalid response.');
  }

  const response = validationResult as { result?: Record<string, unknown> };
  const result = response.result ?? {};
  const status = typeof result.status === 'string' ? result.status : '';
  if (status === 'approval_required') {
    throw new Error('Trustline validation requires approval before execution.');
  }
  if (status === 'rejected') {
    const reason = typeof result.reason === 'string' ? result.reason : 'policy rejected';
    throw new Error(`Trustline validation rejected: ${reason}`);
  }
  if (status !== 'approved') {
    throw new Error('Trustline validation did not return an approved status.');
  }

  const approvalAddress =
    (typeof result.approvalAddress === 'string' && result.approvalAddress) ||
    '';
  if (!approvalAddress) {
    throw new Error('Trustline validation response is missing approvalAddress.');
  }
  return new PublicKey(approvalAddress);
}

function findProtectedInstructionIndexes(transaction: Transaction, programId: PublicKey): number[] {
  const indexes: number[] = [];
  transaction.instructions.forEach((instruction, index) => {
    if (!instruction.programId.equals(programId)) {
      return;
    }
    if (instruction.data.length < 8) {
      return;
    }
    if (PROTECTED_DISCRIMINATORS.has(getInstructionDiscriminator(instruction))) {
      indexes.push(index);
    }
  });
  return indexes;
}

export async function validateAndAttachTrustlineAccounts(params: {
  transaction: Transaction;
  walletAddress: PublicKey;
  vaultAddress: PublicKey;
  programId: PublicKey;
  vault: VaultAccount;
  trustlineClientId: string;
  trustlineApiUrl: string;
  trustlineChainId: string;
  trustlineValidationMode: string | null;
  trustlineApprovalRequired: boolean;
}): Promise<void> {
  if (!params.vault.trustlineEnabled) {
    return;
  }

  const protectedInstructionIndexes = findProtectedInstructionIndexes(
    params.transaction,
    params.programId
  );
  if (protectedInstructionIndexes.length === 0) {
    return;
  }

  trustline.init({
    clientId: params.trustlineClientId,
    apiUrl: params.trustlineApiUrl,
  });

  const engineProgram = TRUSTLINE_VALIDATION_ENGINE_PROGRAM_ID;
  const globalConfig = deriveGlobalConfigPda(engineProgram);
  const protocolConfig = deriveProtocolConfigPda(engineProgram, params.programId);

  for (const protectedInstructionIndex of protectedInstructionIndexes) {
    const protectedInstruction = params.transaction.instructions[protectedInstructionIndex];
    const validationResponse = await trustline.validate({
      chainId: params.trustlineChainId,
      subject: params.walletAddress.toBase58(),
      scope: params.vaultAddress.toBase58(),
      protectedProgram: params.programId.toBase58(),
      instruction: protectedInstruction,
      validationMode: params.trustlineValidationMode,
      approvalRequired: params.trustlineApprovalRequired,
    });

    const approvalAddress = parseApprovalAddress(validationResponse);
    const trailingAccounts: Array<{ pubkey: PublicKey; isWritable: boolean }> = [
      { pubkey: globalConfig, isWritable: false },
      { pubkey: protocolConfig, isWritable: false },
      // consume_approval mutates approval status to Consumed
      { pubkey: approvalAddress, isWritable: true },
      { pubkey: engineProgram, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isWritable: false },
    ];
    const existing = new Set(protectedInstruction.keys.map((key) => key.pubkey.toBase58()));

    for (const account of trailingAccounts) {
      const key = account.pubkey.toBase58();
      if (existing.has(key)) {
        continue;
      }
      protectedInstruction.keys.push({
        pubkey: account.pubkey,
        isSigner: false,
        isWritable: account.isWritable,
      });
    }
  }
}
