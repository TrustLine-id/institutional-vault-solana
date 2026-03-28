import { PublicKey } from '@solana/web3.js';
import { AdapterSnapshot, VaultAccount } from './lib/svs13';

export type InvestorMode = 'deposit' | 'mint' | 'withdraw' | 'redeem';
export type AdminTab = 'investor' | 'authority' | 'curator' | 'allocator';
export type BannerTone = 'info' | 'success' | 'error';

export type BannerState = {
  tone: BannerTone;
  message: string;
  signature?: string;
};

export type VaultViewModel = {
  vault: VaultAccount;
  assetTokenProgram: PublicKey;
  assetDecimals: number;
  shareDecimals: number;
  shareSupply: bigint;
  idleAssets: bigint;
  userAssetBalance: bigint;
  userSharesBalance: bigint;
  userEstimatedAssets: bigint;
  userMaxWithdraw: bigint;
  userMaxRedeem: bigint;
  adapters: AdapterSnapshot[];
};

export type RoleFlags = {
  authority: boolean;
  curator: boolean;
  allocator: boolean;
};

export type InvestorPreviewSuccess = {
  payLabel: string;
  receiveLabel: string;
  payAmount: bigint;
  receiveAmount: bigint;
  minMaxAmount: bigint;
  minMaxLabel: string;
};

export type InvestorPreviewError = {
  error: string;
};

export type InvestorPreview = InvestorPreviewSuccess | InvestorPreviewError | null;
