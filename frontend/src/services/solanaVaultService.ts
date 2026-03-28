import {
  TOKEN_2022_PROGRAM_ID,
  getAccount,
  getMint,
} from '@solana/spl-token';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
  ASSET_LABEL,
  SHARE_LABEL,
} from '../config';
import {
  AdapterSnapshot,
  buildAddAdapterInstruction,
  buildAllocateInstruction,
  buildDepositInstruction,
  buildDeallocateInstruction,
  buildDisableAdapterInstruction,
  buildEnableAdapterInstruction,
  buildMintInstruction,
  buildPauseInstruction,
  buildRedeemInstruction,
  buildRemoveAdapterInstruction,
  buildSetAdapterCapsInstruction,
  buildSetLiquidityAdapterInstruction,
  buildSetRolesInstruction,
  buildSetTrustlineConfigInstruction,
  buildSyncTotalAssetsInstruction,
  buildTransferAuthorityInstruction,
  buildUnpauseInstruction,
  buildWithdrawInstruction,
  convertToAssetsPreview,
  convertToSharesPreview,
  decodeAdapterConfigAccount,
  decodeAdapterPositionAccount,
  decodeVaultAccount,
  deriveAdapterPositionPda,
  deriveUserAssetAta,
  deriveUserShareAta,
  parseAmountInput,
  parseOptionalBytes,
  parseU64Input,
} from '../lib/svs13';
import {
  AdminTab,
  InvestorMode,
  InvestorPreview,
  RoleFlags,
  VaultViewModel,
} from '../types';

export function tryParsePublicKey(value: string): PublicKey | null {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export function clampSlippage(value: string): bigint {
  const parsed = parseU64Input(value) ?? BigInt(0);
  if (parsed > BigInt(5000)) {
    throw new Error('Slippage is capped at 5000 bps for safety');
  }
  return parsed;
}

export function applySlippage(
  amount: bigint,
  bps: bigint,
  direction: 'min' | 'max'
): bigint {
  if (direction === 'min') {
    return (amount * (BigInt(10000) - bps)) / BigInt(10000);
  }
  return (amount * (BigInt(10000) + bps) + BigInt(9999)) / BigInt(10000);
}

async function discoverAdapterSnapshots(params: {
  connection: Connection;
  programId: PublicKey;
  vaultAddress: PublicKey;
  assetTokenProgram: PublicKey;
}): Promise<AdapterSnapshot[]> {
  const programAccounts = await params.connection.getProgramAccounts(params.programId);
  const adapterConfigs = programAccounts
    .flatMap(({ pubkey, account }) => {
      try {
        const config = decodeAdapterConfigAccount(account.data);
        if (!config.vault.equals(params.vaultAddress)) {
          return [];
        }
        return [{ configAddress: pubkey, config }];
      } catch {
        return [];
      }
    })
    .sort((left, right) =>
      left.config.adapterId < right.config.adapterId
        ? -1
        : left.config.adapterId > right.config.adapterId
        ? 1
        : 0
    );

  return Promise.all(
    adapterConfigs.map(async ({ configAddress, config }) => {
      const positionAddress = deriveAdapterPositionPda(
        params.vaultAddress,
        config.adapterId,
        params.programId
      );

      const [positionInfo, holdingBalance] = await Promise.all([
        params.connection.getAccountInfo(positionAddress),
        (async () => {
          try {
            const holdingAccount = await getAccount(
              params.connection,
              config.holdingAccount,
              'confirmed',
              params.assetTokenProgram
            );
            return holdingAccount.amount;
          } catch {
            return null;
          }
        })(),
      ]);

      return {
        id: config.adapterId,
        configAddress,
        positionAddress,
        holdingAddress: config.holdingAccount,
        config,
        position: positionInfo ? decodeAdapterPositionAccount(positionInfo.data) : null,
        holdingBalance,
      };
    })
  );
}

export async function fetchVaultViewModel(params: {
  connection: Connection;
  publicKey: PublicKey | null;
  programId: PublicKey;
  vaultAddress: PublicKey;
}): Promise<VaultViewModel> {
  const vaultInfo = await params.connection.getAccountInfo(params.vaultAddress);
  if (!vaultInfo) {
    throw new Error('Vault account was not found on the selected cluster.');
  }

  const vault = decodeVaultAccount(vaultInfo.data);
  const assetMintInfo = await params.connection.getAccountInfo(vault.assetMint);
  if (!assetMintInfo) {
    throw new Error('Asset mint account could not be loaded.');
  }

  const assetTokenProgram = assetMintInfo.owner;
  const [assetMint, shareMint, assetVaultAccount] = await Promise.all([
    getMint(params.connection, vault.assetMint, 'confirmed', assetTokenProgram),
    getMint(params.connection, vault.sharesMint, 'confirmed', TOKEN_2022_PROGRAM_ID),
    getAccount(params.connection, vault.assetVault, 'confirmed', assetTokenProgram),
  ]);

  let userAssetBalance = BigInt(0);
  let userSharesBalance = BigInt(0);

  if (params.publicKey) {
    const userAssetAta = deriveUserAssetAta(
      params.publicKey,
      vault.assetMint,
      assetTokenProgram
    );
    const userSharesAta = deriveUserShareAta(params.publicKey, vault.sharesMint);

    try {
      const userAssetAccount = await getAccount(
        params.connection,
        userAssetAta,
        'confirmed',
        assetTokenProgram
      );
      userAssetBalance = userAssetAccount.amount;
    } catch {
      userAssetBalance = BigInt(0);
    }

    try {
      const userSharesAccount = await getAccount(
        params.connection,
        userSharesAta,
        'confirmed',
        TOKEN_2022_PROGRAM_ID
      );
      userSharesBalance = userSharesAccount.amount;
    } catch {
      userSharesBalance = BigInt(0);
    }
  }

  const adapters = await discoverAdapterSnapshots({
    connection: params.connection,
    programId: params.programId,
    vaultAddress: params.vaultAddress,
    assetTokenProgram,
  });

  const userEstimatedAssets = convertToAssetsPreview(
    userSharesBalance,
    vault.totalAssets,
    shareMint.supply,
    vault.decimalsOffset,
    'floor'
  );

  const userMaxWithdraw =
    userEstimatedAssets < assetVaultAccount.amount ? userEstimatedAssets : assetVaultAccount.amount;

  return {
    vault,
    assetTokenProgram,
    assetDecimals: assetMint.decimals,
    shareDecimals: shareMint.decimals,
    shareSupply: shareMint.supply,
    idleAssets: assetVaultAccount.amount,
    userAssetBalance,
    userSharesBalance,
    userEstimatedAssets,
    userMaxWithdraw,
    userMaxRedeem: userSharesBalance,
    adapters,
  };
}

export function computeRoleFlags(
  publicKey: PublicKey | null,
  vaultData: VaultViewModel | null
): RoleFlags {
  const vault = vaultData?.vault;
  if (!publicKey || !vault) {
    return {
      authority: false,
      curator: false,
      allocator: false,
    };
  }

  return {
    authority: publicKey.equals(vault.authority),
    curator: publicKey.equals(vault.curator),
    allocator: publicKey.equals(vault.allocator),
  };
}

export function computeVisibleTabs(roleFlags: RoleFlags): AdminTab[] {
  const tabs: AdminTab[] = ['investor'];
  if (roleFlags.authority) {
    tabs.push('authority');
  }
  if (roleFlags.curator) {
    tabs.push('curator');
  }
  if (roleFlags.allocator) {
    tabs.push('allocator');
  }
  return tabs;
}

export function computeSharePriceBase(vaultData: VaultViewModel | null): bigint {
  if (!vaultData) {
    return BigInt(0);
  }
  return convertToAssetsPreview(
    BigInt(10) ** BigInt(vaultData.shareDecimals),
    vaultData.vault.totalAssets,
    vaultData.shareSupply,
    vaultData.vault.decimalsOffset,
    'floor'
  );
}

export function computeOwnershipBps(vaultData: VaultViewModel | null): bigint {
  if (!vaultData || vaultData.shareSupply === BigInt(0)) {
    return BigInt(0);
  }
  return (vaultData.userSharesBalance * BigInt(10000)) / vaultData.shareSupply;
}

export function computeInvestorPreview(params: {
  investorMode: InvestorMode;
  investorAmount: string;
  investorSlippage: string;
  vaultData: VaultViewModel | null;
}): InvestorPreview {
  if (!params.vaultData) {
    return null;
  }

  try {
    const inputAmount =
      params.investorMode === 'deposit' || params.investorMode === 'withdraw'
        ? parseAmountInput(params.investorAmount, params.vaultData.assetDecimals)
        : parseAmountInput(params.investorAmount, params.vaultData.shareDecimals);
    const slippage = clampSlippage(params.investorSlippage);

    if (inputAmount === null) {
      return null;
    }

    if (params.investorMode === 'deposit') {
      const sharesOut = convertToSharesPreview(
        inputAmount,
        params.vaultData.vault.totalAssets,
        params.vaultData.shareSupply,
        params.vaultData.vault.decimalsOffset,
        'floor'
      );
      return {
        payLabel: ASSET_LABEL,
        receiveLabel: SHARE_LABEL,
        payAmount: inputAmount,
        receiveAmount: sharesOut,
        minMaxAmount: applySlippage(sharesOut, slippage, 'min'),
        minMaxLabel: 'Min shares out',
      };
    }

    if (params.investorMode === 'mint') {
      const assetsIn = convertToAssetsPreview(
        inputAmount,
        params.vaultData.vault.totalAssets,
        params.vaultData.shareSupply,
        params.vaultData.vault.decimalsOffset,
        'ceiling'
      );
      return {
        payLabel: ASSET_LABEL,
        receiveLabel: SHARE_LABEL,
        payAmount: assetsIn,
        receiveAmount: inputAmount,
        minMaxAmount: applySlippage(assetsIn, slippage, 'max'),
        minMaxLabel: 'Max assets in',
      };
    }

    if (params.investorMode === 'withdraw') {
      const sharesIn = convertToSharesPreview(
        inputAmount,
        params.vaultData.vault.totalAssets,
        params.vaultData.shareSupply,
        params.vaultData.vault.decimalsOffset,
        'ceiling'
      );
      return {
        payLabel: SHARE_LABEL,
        receiveLabel: ASSET_LABEL,
        payAmount: sharesIn,
        receiveAmount: inputAmount,
        minMaxAmount: applySlippage(sharesIn, slippage, 'max'),
        minMaxLabel: 'Max shares in',
      };
    }

    const assetsOut = convertToAssetsPreview(
      inputAmount,
      params.vaultData.vault.totalAssets,
      params.vaultData.shareSupply,
      params.vaultData.vault.decimalsOffset,
      'floor'
    );
    return {
      payLabel: SHARE_LABEL,
      receiveLabel: ASSET_LABEL,
      payAmount: inputAmount,
      receiveAmount: assetsOut,
      minMaxAmount: applySlippage(assetsOut, slippage, 'min'),
      minMaxLabel: 'Min assets out',
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unable to compute preview',
    };
  }
}

function getRegisteredAdapter(vaultData: VaultViewModel, adapterId: bigint): AdapterSnapshot {
  const adapter = vaultData.adapters.find((item) => item.id === adapterId);
  if (!adapter) {
    throw new Error(`Adapter ${adapterId.toString()} was not found in the on-chain registry.`);
  }
  return adapter;
}

export function getLiquidityAccounts(params: {
  vaultData: VaultViewModel;
  adapterId: bigint;
}) {
  const adapter = getRegisteredAdapter(params.vaultData, params.adapterId);
  if (!adapter.config) {
    throw new Error(`Adapter ${params.adapterId.toString()} config could not be decoded.`);
  }

  return {
    config: adapter.configAddress,
    position: adapter.positionAddress,
    holding: adapter.holdingAddress,
    program: adapter.config.adapterProgram,
  };
}

export function buildInvestorTransaction(params: {
  investorMode: InvestorMode;
  investorAmount: string;
  investorSlippage: string;
  vaultData: VaultViewModel;
  programId: PublicKey;
  vaultAddress: PublicKey;
  publicKey: PublicKey;
}): Transaction {
  const slippage = clampSlippage(params.investorSlippage);
  const userAssetAccount = deriveUserAssetAta(
    params.publicKey,
    params.vaultData.vault.assetMint,
    params.vaultData.assetTokenProgram
  );
  const userSharesAccount = deriveUserShareAta(
    params.publicKey,
    params.vaultData.vault.sharesMint
  );
  const transaction = new Transaction();

  if (params.investorMode === 'deposit') {
    const assets = parseAmountInput(params.investorAmount, params.vaultData.assetDecimals);
    if (assets === null) {
      throw new Error('Enter an asset amount to deposit.');
    }
    const minSharesOut = applySlippage(
      convertToSharesPreview(
        assets,
        params.vaultData.vault.totalAssets,
        params.vaultData.shareSupply,
        params.vaultData.vault.decimalsOffset,
        'floor'
      ),
      slippage,
      'min'
    );
    transaction.add(
      buildDepositInstruction({
        programId: params.programId,
        user: params.publicKey,
        vault: params.vaultAddress,
        assetMint: params.vaultData.vault.assetMint,
        userAssetAccount,
        assetVault: params.vaultData.vault.assetVault,
        sharesMint: params.vaultData.vault.sharesMint,
        userSharesAccount,
        assetTokenProgram: params.vaultData.assetTokenProgram,
        assets,
        minSharesOut,
        liquidityAccounts: params.vaultData.vault.liquidityAdapterId
          ? getLiquidityAccounts({
              vaultData: params.vaultData,
              adapterId: params.vaultData.vault.liquidityAdapterId,
            })
          : undefined,
      })
    );
  }

  if (params.investorMode === 'mint') {
    const shares = parseAmountInput(params.investorAmount, params.vaultData.shareDecimals);
    if (shares === null) {
      throw new Error('Enter a share amount to mint.');
    }
    const maxAssetsIn = applySlippage(
      convertToAssetsPreview(
        shares,
        params.vaultData.vault.totalAssets,
        params.vaultData.shareSupply,
        params.vaultData.vault.decimalsOffset,
        'ceiling'
      ),
      slippage,
      'max'
    );
    transaction.add(
      buildMintInstruction({
        programId: params.programId,
        user: params.publicKey,
        vault: params.vaultAddress,
        assetMint: params.vaultData.vault.assetMint,
        userAssetAccount,
        assetVault: params.vaultData.vault.assetVault,
        sharesMint: params.vaultData.vault.sharesMint,
        userSharesAccount,
        assetTokenProgram: params.vaultData.assetTokenProgram,
        shares,
        maxAssetsIn,
        liquidityAccounts: params.vaultData.vault.liquidityAdapterId
          ? getLiquidityAccounts({
              vaultData: params.vaultData,
              adapterId: params.vaultData.vault.liquidityAdapterId,
            })
          : undefined,
      })
    );
  }

  if (params.investorMode === 'withdraw') {
    const assets = parseAmountInput(params.investorAmount, params.vaultData.assetDecimals);
    if (assets === null) {
      throw new Error('Enter an asset amount to withdraw.');
    }
    const maxSharesIn = applySlippage(
      convertToSharesPreview(
        assets,
        params.vaultData.vault.totalAssets,
        params.vaultData.shareSupply,
        params.vaultData.vault.decimalsOffset,
        'ceiling'
      ),
      slippage,
      'max'
    );
    transaction.add(
      buildWithdrawInstruction({
        programId: params.programId,
        user: params.publicKey,
        vault: params.vaultAddress,
        assetMint: params.vaultData.vault.assetMint,
        userAssetAccount,
        assetVault: params.vaultData.vault.assetVault,
        sharesMint: params.vaultData.vault.sharesMint,
        userSharesAccount,
        assetTokenProgram: params.vaultData.assetTokenProgram,
        assets,
        maxSharesIn,
      })
    );
  }

  if (params.investorMode === 'redeem') {
    const shares = parseAmountInput(params.investorAmount, params.vaultData.shareDecimals);
    if (shares === null) {
      throw new Error('Enter a share amount to redeem.');
    }
    const minAssetsOut = applySlippage(
      convertToAssetsPreview(
        shares,
        params.vaultData.vault.totalAssets,
        params.vaultData.shareSupply,
        params.vaultData.vault.decimalsOffset,
        'floor'
      ),
      slippage,
      'min'
    );
    transaction.add(
      buildRedeemInstruction({
        programId: params.programId,
        user: params.publicKey,
        vault: params.vaultAddress,
        assetMint: params.vaultData.vault.assetMint,
        userAssetAccount,
        assetVault: params.vaultData.vault.assetVault,
        sharesMint: params.vaultData.vault.sharesMint,
        userSharesAccount,
        assetTokenProgram: params.vaultData.assetTokenProgram,
        shares,
        minAssetsOut,
      })
    );
  }

  return transaction;
}

export function buildAuthorityPauseTransaction(params: {
  action: 'pause' | 'unpause';
  programId: PublicKey;
  publicKey: PublicKey;
  vaultAddress: PublicKey;
}): Transaction {
  const transaction = new Transaction();
  transaction.add(
    params.action === 'pause'
      ? buildPauseInstruction(params.programId, params.publicKey, params.vaultAddress)
      : buildUnpauseInstruction(params.programId, params.publicKey, params.vaultAddress)
  );
  return transaction;
}

export function buildTransferAuthorityTransaction(params: {
  programId: PublicKey;
  publicKey: PublicKey;
  vaultAddress: PublicKey;
  newAuthority: string;
}): Transaction {
  const nextAuthority = tryParsePublicKey(params.newAuthority.trim());
  if (!nextAuthority) {
    throw new Error('Enter a valid authority address.');
  }

  const transaction = new Transaction();
  transaction.add(
    buildTransferAuthorityInstruction({
      programId: params.programId,
      authority: params.publicKey,
      vault: params.vaultAddress,
      newAuthority: nextAuthority,
    })
  );
  return transaction;
}

export function buildSetTrustlineConfigTransaction(params: {
  programId: PublicKey;
  publicKey: PublicKey;
  vaultAddress: PublicKey;
  enabled: boolean;
}): Transaction {
  const transaction = new Transaction();
  transaction.add(
    buildSetTrustlineConfigInstruction({
      programId: params.programId,
      authority: params.publicKey,
      vault: params.vaultAddress,
      enabled: params.enabled,
    })
  );
  return transaction;
}

export function buildSetRolesTransaction(params: {
  programId: PublicKey;
  publicKey: PublicKey;
  vaultAddress: PublicKey;
  newCurator: string;
  newAllocator: string;
}): Transaction {
  const curator = tryParsePublicKey(params.newCurator.trim());
  const allocator = tryParsePublicKey(params.newAllocator.trim());
  if (!curator || !allocator) {
    throw new Error('Enter valid curator and allocator addresses.');
  }

  const transaction = new Transaction();
  transaction.add(
    buildSetRolesInstruction({
      programId: params.programId,
      authority: params.publicKey,
      vault: params.vaultAddress,
      curator,
      allocator,
    })
  );
  return transaction;
}

export function buildAddAdapterTransaction(params: {
  programId: PublicKey;
  publicKey: PublicKey;
  vaultAddress: PublicKey;
  addAdapterId: string;
  addAdapterProgram: string;
  addAdapterCap: string;
  addAdapterHoldingAddress: string;
}): Transaction {
  const adapterId = parseU64Input(params.addAdapterId);
  const adapterProgram = tryParsePublicKey(params.addAdapterProgram.trim());
  const maxAllocationAbs = parseU64Input(params.addAdapterCap) ?? BigInt(0);
  const adapterHolding = tryParsePublicKey(params.addAdapterHoldingAddress.trim());
  if (adapterId === null || !adapterProgram || !adapterHolding) {
    throw new Error('Enter a valid adapter id, adapter program address, and holding account.');
  }

  const transaction = new Transaction();
  transaction.add(
    buildAddAdapterInstruction({
      programId: params.programId,
      authority: params.publicKey,
      vault: params.vaultAddress,
      adapterId,
      adapterProgram,
      maxAllocationAbs,
      adapterHolding,
    })
  );
  return transaction;
}

export function buildRemoveAdapterTransaction(params: {
  programId: PublicKey;
  publicKey: PublicKey;
  vaultAddress: PublicKey;
  removeAdapterId: string;
}): Transaction {
  const adapterId = parseU64Input(params.removeAdapterId);
  if (adapterId === null) {
    throw new Error('Enter a valid adapter id.');
  }

  const transaction = new Transaction();
  transaction.add(
    buildRemoveAdapterInstruction({
      programId: params.programId,
      authority: params.publicKey,
      vault: params.vaultAddress,
      adapterId,
    })
  );
  return transaction;
}

export function buildCuratorTransaction(params: {
  action: 'setLiquidityAdapter' | 'setAdapterCap' | 'enableAdapter' | 'disableAdapter' | 'sync';
  programId: PublicKey;
  publicKey: PublicKey;
  vaultAddress: PublicKey;
  vaultData: VaultViewModel;
  liquidityAdapterId: string;
  capAdapterId: string;
  capAmount: string;
  enableAdapterId: string;
  disableAdapterId: string;
}): Transaction {
  const transaction = new Transaction();

  if (params.action === 'setLiquidityAdapter') {
    const adapterId = parseU64Input(params.liquidityAdapterId) ?? BigInt(0);
    transaction.add(
      buildSetLiquidityAdapterInstruction({
        programId: params.programId,
        curator: params.publicKey,
        vault: params.vaultAddress,
        adapterId,
      })
    );
  }

  if (params.action === 'setAdapterCap') {
    const adapterId = parseU64Input(params.capAdapterId);
    const maxAllocationAbs = parseU64Input(params.capAmount) ?? BigInt(0);
    if (adapterId === null) {
      throw new Error('Enter a valid adapter id.');
    }
    transaction.add(
      buildSetAdapterCapsInstruction({
        programId: params.programId,
        curator: params.publicKey,
        vault: params.vaultAddress,
        adapterId,
        maxAllocationAbs,
      })
    );
  }

  if (params.action === 'enableAdapter') {
    const adapterId = parseU64Input(params.enableAdapterId);
    if (adapterId === null) {
      throw new Error('Enter a valid adapter id.');
    }
    transaction.add(
      buildEnableAdapterInstruction({
        programId: params.programId,
        curator: params.publicKey,
        vault: params.vaultAddress,
        adapterId,
      })
    );
  }

  if (params.action === 'disableAdapter') {
    const adapterId = parseU64Input(params.disableAdapterId);
    if (adapterId === null) {
      throw new Error('Enter a valid adapter id.');
    }
    transaction.add(
      buildDisableAdapterInstruction({
        programId: params.programId,
        curator: params.publicKey,
        vault: params.vaultAddress,
        adapterId,
      })
    );
  }

  if (params.action === 'sync') {
    transaction.add(
      buildSyncTotalAssetsInstruction({
        programId: params.programId,
        curator: params.publicKey,
        vault: params.vaultAddress,
        assetVault: params.vaultData.vault.assetVault,
        adapters: params.vaultData.adapters,
      })
    );
  }

  return transaction;
}

export function buildAllocatorTransaction(params: {
  action: 'allocate' | 'deallocate';
  programId: PublicKey;
  publicKey: PublicKey;
  vaultAddress: PublicKey;
  vaultData: VaultViewModel;
  allocatorAdapterId: string;
  allocatorAmount: string;
  allocatorData: string;
}): Transaction {
  const adapterId = parseU64Input(params.allocatorAdapterId);
  const amount = parseAmountInput(params.allocatorAmount, params.vaultData.assetDecimals);
  const data = parseOptionalBytes(params.allocatorData);
  const adapter = adapterId === null ? null : getRegisteredAdapter(params.vaultData, adapterId);

  if (adapterId === null || amount === null || !adapter) {
    throw new Error('Enter a valid adapter id and amount.');
  }
  if (!adapter.config) {
    throw new Error(`Adapter ${adapterId.toString()} config could not be decoded.`);
  }

  const transaction = new Transaction();
  transaction.add(
    params.action === 'allocate'
      ? buildAllocateInstruction({
          programId: params.programId,
          allocator: params.publicKey,
          vault: params.vaultAddress,
          adapterId,
          adapterProgram: adapter.config.adapterProgram,
          assetVault: params.vaultData.vault.assetVault,
          adapterHolding: adapter.holdingAddress,
          assetMint: params.vaultData.vault.assetMint,
          assetTokenProgram: params.vaultData.assetTokenProgram,
          amount,
          data,
        })
      : buildDeallocateInstruction({
          programId: params.programId,
          allocator: params.publicKey,
          vault: params.vaultAddress,
          adapterId,
          adapterProgram: adapter.config.adapterProgram,
          assetVault: params.vaultData.vault.assetVault,
          adapterHolding: adapter.holdingAddress,
          assetMint: params.vaultData.vault.assetMint,
          assetTokenProgram: params.vaultData.assetTokenProgram,
          amount,
          data,
        })
  );

  return transaction;
}
