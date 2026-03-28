import { useConnection, useWallet, WalletContextState } from '@solana/wallet-adapter-react';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';

export type WalletServiceState = {
  connection: Connection;
  publicKey: PublicKey | null;
  connected: boolean;
  sendTransaction: WalletContextState['sendTransaction'];
};

export function useWalletService(): WalletServiceState {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();

  return {
    connection,
    publicKey,
    connected,
    sendTransaction,
  };
}

export async function sendAndConfirmWalletTransaction(params: {
  connection: Connection;
  sendTransaction: WalletContextState['sendTransaction'];
  transaction: Transaction;
}): Promise<string> {
  if (!params.sendTransaction) {
    throw new Error('Wallet does not expose sendTransaction.');
  }

  const signature = await params.sendTransaction(params.transaction, params.connection);
  await params.connection.confirmTransaction(signature, 'confirmed');
  return signature;
}
