import {
  SolanaInstructionPayload,
  SolanaTransactionInstructionLike,
} from './types';

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `0x${hex}`;
}

function toUint8Array(data: Uint8Array | ArrayLike<number>): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  return Uint8Array.from(data);
}

function normalizePubkey(pubkey: string | { toBase58(): string } | { toString(): string }): string {
  if (typeof pubkey === 'string') {
    return pubkey;
  }
  if ('toBase58' in pubkey && typeof pubkey.toBase58 === 'function') {
    return pubkey.toBase58();
  }
  return pubkey.toString();
}

export function buildInstructionPayload(
  instruction: SolanaTransactionInstructionLike
): SolanaInstructionPayload {
  return {
    data: bytesToHex(toUint8Array(instruction.data)),
    accounts: instruction.keys.map((key) => ({
      pubkey: normalizePubkey(key.pubkey),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
  };
}

export function isTransactionInstructionLike(
  instruction: SolanaInstructionPayload | SolanaTransactionInstructionLike
): instruction is SolanaTransactionInstructionLike {
  if (!instruction || typeof instruction !== 'object') {
    return false;
  }
  return 'keys' in instruction && Array.isArray((instruction as SolanaTransactionInstructionLike).keys);
}
