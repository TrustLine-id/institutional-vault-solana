import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PROGRAM_ID,
  TRUSTLINE_API_URL,
  TRUSTLINE_APPROVAL_REQUIRED,
  TRUSTLINE_CHAIN_ID,
  TRUSTLINE_CLIENT_ID,
  TRUSTLINE_VALIDATION_MODE,
  VAULT_ADDRESS,
} from './config';
import { AllocatorPanel } from './components/AllocatorPanel';
import { AuthorityPanel } from './components/AuthorityPanel';
import { Banner } from './components/Banner';
import { CuratorPanel } from './components/CuratorPanel';
import { HeaderBar } from './components/HeaderBar';
import { InvestorPanel } from './components/InvestorPanel';
import { TabStrip } from './components/TabStrip';
import { VaultOverviewPanel } from './components/VaultOverviewPanel';
import {
  buildAddAdapterTransaction,
  buildAllocatorTransaction,
  buildAuthorityPauseTransaction,
  buildCuratorTransaction,
  buildInvestorTransaction,
  buildRemoveAdapterTransaction,
  buildSetRolesTransaction,
  buildSetTrustlineConfigTransaction,
  buildTransferAuthorityTransaction,
  computeInvestorPreview,
  computeOwnershipBps,
  computeRoleFlags,
  computeSharePriceBase,
  computeVisibleTabs,
  fetchVaultViewModel,
  tryParsePublicKey,
} from './services/solanaVaultService';
import {
  sendAndConfirmWalletTransaction,
  useWalletService,
} from './services/walletService';
import { validateAndAttachTrustlineAccounts } from './services/trustlineService';
import {
  AdminTab,
  BannerState,
  InvestorMode,
  InvestorPreview,
  RoleFlags,
  VaultViewModel,
} from './types';
import './App.css';

const DEFAULT_SLIPPAGE_BPS = '50';

function App() {
  const { connection, publicKey, connected, sendTransaction } = useWalletService();

  const [vaultData, setVaultData] = useState<VaultViewModel | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('investor');
  const [investorMode, setInvestorMode] = useState<InvestorMode>('deposit');
  const [investorAmount, setInvestorAmount] = useState('');
  const [investorSlippage, setInvestorSlippage] = useState(DEFAULT_SLIPPAGE_BPS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);

  const [newAuthority, setNewAuthority] = useState('');
  const [newCurator, setNewCurator] = useState('');
  const [newAllocator, setNewAllocator] = useState('');
  const [addAdapterId, setAddAdapterId] = useState('1');
  const [addAdapterProgram, setAddAdapterProgram] = useState('');
  const [addAdapterCap, setAddAdapterCap] = useState('0');
  const [addAdapterHoldingAddress, setAddAdapterHoldingAddress] = useState('');
  const [removeAdapterId, setRemoveAdapterId] = useState('');

  const [liquidityAdapterId, setLiquidityAdapterId] = useState('0');
  const [capAdapterId, setCapAdapterId] = useState('');
  const [capAmount, setCapAmount] = useState('0');
  const [enableAdapterId, setEnableAdapterId] = useState('');
  const [disableAdapterId, setDisableAdapterId] = useState('');

  const [allocatorAdapterId, setAllocatorAdapterId] = useState('');
  const [allocatorAmount, setAllocatorAmount] = useState('');
  const [allocatorData, setAllocatorData] = useState('');

  const programId = useMemo(() => tryParsePublicKey(PROGRAM_ID), []);
  const vaultAddress = useMemo(() => tryParsePublicKey(VAULT_ADDRESS), []);

  const loadVaultData = useCallback(async () => {
    if (!programId || !vaultAddress) {
      setBanner({
        tone: 'error',
        message:
          'Set a valid program id and vault address in src/config.ts before using the dashboard.',
      });
      setLoading(false);
      return;
    }

    setRefreshing(true);
    try {
      const nextVaultData = await fetchVaultViewModel({
        connection,
        publicKey,
        programId,
        vaultAddress,
      });
      setVaultData(nextVaultData);

      setBanner((previous) =>
        previous?.tone === 'error' && previous.message.includes('src/config.ts')
          ? null
          : previous
      );
    } catch (error) {
      setBanner({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Failed to load vault state.',
      });
      setVaultData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [connection, programId, publicKey, vaultAddress]);

  useEffect(() => {
    void loadVaultData();
  }, [loadVaultData]);

  useEffect(() => {
    if (vaultData?.vault) {
      setLiquidityAdapterId(
        vaultData.vault.liquidityAdapterId?.toString() ?? '0'
      );
    }
  }, [vaultData?.vault]);

  const roleFlags = useMemo<RoleFlags>(
    () => computeRoleFlags(publicKey, vaultData),
    [publicKey, vaultData]
  );

  const visibleTabs = useMemo<AdminTab[]>(
    () => computeVisibleTabs(roleFlags),
    [roleFlags]
  );

  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab('investor');
    }
  }, [activeTab, visibleTabs]);

  const sharePriceBase = useMemo(() => computeSharePriceBase(vaultData), [vaultData]);

  const ownershipBps = useMemo(() => computeOwnershipBps(vaultData), [vaultData]);

  const preview = useMemo<InvestorPreview>(
    () =>
      computeInvestorPreview({
        investorMode,
        investorAmount,
        investorSlippage,
        vaultData,
      }),
    [investorAmount, investorMode, investorSlippage, vaultData]
  );

  const sendInstruction = useCallback(
    async (label: string, transactionBuilder: () => Promise<ReturnType<typeof buildInvestorTransaction>>) => {
      if (!connected || !publicKey) {
        throw new Error('Connect a wallet first.');
      }
      if (!vaultAddress || !programId || !vaultData) {
        throw new Error('Vault is not ready yet.');
      }

      setPendingAction(label);
      setBanner({
        tone: 'info',
        message: `${label} pending approval...`,
      });

      try {
        const transaction = await transactionBuilder();
        await validateAndAttachTrustlineAccounts({
          transaction,
          walletAddress: publicKey,
          vaultAddress,
          programId,
          vault: vaultData.vault,
          trustlineClientId: TRUSTLINE_CLIENT_ID,
          trustlineApiUrl: TRUSTLINE_API_URL,
          trustlineChainId: TRUSTLINE_CHAIN_ID,
          trustlineValidationMode: TRUSTLINE_VALIDATION_MODE,
          trustlineApprovalRequired: TRUSTLINE_APPROVAL_REQUIRED,
        });
        const signature = await sendAndConfirmWalletTransaction({
          connection,
          sendTransaction,
          transaction,
        });
        setBanner({
          tone: 'success',
          message: `${label} confirmed.`,
          signature,
        });
        await loadVaultData();
      } catch (error) {
        setBanner({
          tone: 'error',
          message: error instanceof Error ? error.message : `${label} failed.`,
        });
      } finally {
        setPendingAction(null);
      }
    },
    [connected, connection, loadVaultData, programId, publicKey, sendTransaction, vaultAddress, vaultData]
  );

  const handleInvestorSubmit = async () => {
    if (!vaultData || !programId || !vaultAddress || !publicKey) {
      throw new Error('Vault is not ready yet.');
    }

    await sendInstruction(
      investorMode.charAt(0).toUpperCase() + investorMode.slice(1),
      async () =>
        buildInvestorTransaction({
          investorMode,
          investorAmount,
          investorSlippage,
          vaultData,
          programId,
          vaultAddress,
          publicKey,
        })
    );
  };

  const handleAuthorityAction = async (action: 'pause' | 'unpause') => {
    if (!programId || !vaultAddress || !publicKey) {
      throw new Error('Wallet or config missing.');
    }
    await sendInstruction(action === 'pause' ? 'Pause vault' : 'Unpause vault', async () =>
      buildAuthorityPauseTransaction({
        action,
        programId,
        publicKey,
        vaultAddress,
      })
    );
  };

  const handleTransferAuthority = async () => {
    if (!programId || !vaultAddress || !publicKey) {
      throw new Error('Wallet or config missing.');
    }
    await sendInstruction('Transfer authority', async () =>
      buildTransferAuthorityTransaction({
        programId,
        publicKey,
        vaultAddress,
        newAuthority,
      })
    );
  };

  const handleSetTrustlineConfig = async (enabled: boolean) => {
    if (!programId || !vaultAddress || !publicKey) {
      throw new Error('Wallet or config missing.');
    }
    await sendInstruction(enabled ? 'Enable Trustline' : 'Disable Trustline', async () =>
      buildSetTrustlineConfigTransaction({
        programId,
        publicKey,
        vaultAddress,
        enabled,
      })
    );
  };

  const handleSetRoles = async () => {
    if (!programId || !vaultAddress || !publicKey) {
      throw new Error('Wallet or config missing.');
    }

    await sendInstruction('Set roles', async () =>
      buildSetRolesTransaction({
        programId,
        publicKey,
        vaultAddress,
        newCurator,
        newAllocator,
      })
    );
  };

  const handleAddAdapter = async () => {
    if (!programId || !vaultAddress || !publicKey) {
      throw new Error('Wallet or config missing.');
    }
    await sendInstruction('Add adapter', async () =>
      buildAddAdapterTransaction({
        programId,
        publicKey,
        vaultAddress,
        addAdapterId,
        addAdapterProgram,
        addAdapterCap,
        addAdapterHoldingAddress,
      })
    );
  };

  const handleRemoveAdapter = async () => {
    if (!programId || !vaultAddress || !publicKey) {
      throw new Error('Wallet or config missing.');
    }
    await sendInstruction('Remove adapter', async () =>
      buildRemoveAdapterTransaction({
        programId,
        publicKey,
        vaultAddress,
        removeAdapterId,
      })
    );
  };

  const handleCuratorAction = async (
    action: 'setLiquidityAdapter' | 'setAdapterCap' | 'enableAdapter' | 'disableAdapter' | 'sync'
  ) => {
    if (!programId || !vaultAddress || !publicKey || !vaultData) {
      throw new Error('Vault is not ready yet.');
    }

    await sendInstruction(
      action === 'sync'
        ? 'Sync total assets'
        : action === 'setLiquidityAdapter'
        ? 'Set liquidity adapter'
        : action === 'setAdapterCap'
        ? 'Update adapter cap'
        : action === 'enableAdapter'
        ? 'Enable adapter'
        : 'Disable adapter',
      async () =>
        buildCuratorTransaction({
          action,
          programId,
          publicKey,
          vaultAddress,
          vaultData,
          liquidityAdapterId,
          capAdapterId,
          capAmount,
          enableAdapterId,
          disableAdapterId,
        })
    );
  };

  const handleAllocatorAction = async (action: 'allocate' | 'deallocate') => {
    if (!programId || !vaultAddress || !publicKey || !vaultData) {
      throw new Error('Vault is not ready yet.');
    }
    await sendInstruction(
      action === 'allocate' ? 'Allocate capital' : 'Deallocate capital',
      async () =>
        buildAllocatorTransaction({
          action,
          programId,
          publicKey,
          vaultAddress,
          vaultData,
          allocatorAdapterId,
          allocatorAmount,
          allocatorData,
        })
    );
  };

  const canSubmitInvestor = connected && !!vaultData && !pendingAction;

  return (
    <div className="app-shell">
      <HeaderBar publicKey={publicKey} />

      <main className="page">
        <Banner banner={banner} />

        <VaultOverviewPanel
          loading={loading}
          refreshing={refreshing}
          vaultData={vaultData}
          roleFlags={roleFlags}
          sharePriceBase={sharePriceBase}
          vaultAddress={vaultAddress}
          programId={programId}
          onRefresh={() => void loadVaultData()}
        />

        {visibleTabs.length > 1 ? (
          <TabStrip activeTab={activeTab} roleFlags={roleFlags} onSelectTab={setActiveTab} />
        ) : null}

        {activeTab === 'investor' ? (
          <InvestorPanel
            vaultData={vaultData}
            investorMode={investorMode}
            investorAmount={investorAmount}
            investorSlippage={investorSlippage}
            ownershipBps={ownershipBps}
            preview={preview}
            canSubmitInvestor={canSubmitInvestor}
            connected={connected}
            pendingAction={pendingAction}
            onSetInvestorMode={setInvestorMode}
            onSetInvestorAmount={setInvestorAmount}
            onSetInvestorSlippage={setInvestorSlippage}
            onSubmit={() => void handleInvestorSubmit()}
          />
        ) : null}

        {roleFlags.authority && activeTab === 'authority' ? (
          <AuthorityPanel
            pendingAction={pendingAction}
            trustlineEnabled={vaultData?.vault.trustlineEnabled ?? false}
            trustlineEngine={
              vaultData?.vault ? vaultData.vault.validationEngine.toBase58() : 'Unavailable'
            }
            newAuthority={newAuthority}
            newCurator={newCurator}
            newAllocator={newAllocator}
            addAdapterId={addAdapterId}
            addAdapterProgram={addAdapterProgram}
            addAdapterCap={addAdapterCap}
            addAdapterHoldingAddress={addAdapterHoldingAddress}
            removeAdapterId={removeAdapterId}
            onSetNewAuthority={setNewAuthority}
            onSetNewCurator={setNewCurator}
            onSetNewAllocator={setNewAllocator}
            onSetAddAdapterId={setAddAdapterId}
            onSetAddAdapterProgram={setAddAdapterProgram}
            onSetAddAdapterCap={setAddAdapterCap}
            onSetAddAdapterHoldingAddress={setAddAdapterHoldingAddress}
            onSetRemoveAdapterId={setRemoveAdapterId}
            onPause={() => void handleAuthorityAction('pause')}
            onUnpause={() => void handleAuthorityAction('unpause')}
            onEnableTrustline={() => void handleSetTrustlineConfig(true)}
            onDisableTrustline={() => void handleSetTrustlineConfig(false)}
            onTransferAuthority={() => void handleTransferAuthority()}
            onSetRoles={() => void handleSetRoles()}
            onAddAdapter={() => void handleAddAdapter()}
            onRemoveAdapter={() => void handleRemoveAdapter()}
          />
        ) : null}

        {roleFlags.curator && activeTab === 'curator' ? (
          <CuratorPanel
            pendingAction={pendingAction}
            liquidityAdapterId={liquidityAdapterId}
            capAdapterId={capAdapterId}
            capAmount={capAmount}
            enableAdapterId={enableAdapterId}
            disableAdapterId={disableAdapterId}
            onSetLiquidityAdapterId={setLiquidityAdapterId}
            onSetCapAdapterId={setCapAdapterId}
            onSetCapAmount={setCapAmount}
            onSetEnableAdapterId={setEnableAdapterId}
            onSetDisableAdapterId={setDisableAdapterId}
            onSync={() => void handleCuratorAction('sync')}
            onSetLiquidityAdapter={() => void handleCuratorAction('setLiquidityAdapter')}
            onSetAdapterCap={() => void handleCuratorAction('setAdapterCap')}
            onEnableAdapter={() => void handleCuratorAction('enableAdapter')}
            onDisableAdapter={() => void handleCuratorAction('disableAdapter')}
          />
        ) : null}

        {roleFlags.allocator && activeTab === 'allocator' ? (
          <AllocatorPanel
            vaultData={vaultData}
            pendingAction={pendingAction}
            allocatorAdapterId={allocatorAdapterId}
            allocatorAmount={allocatorAmount}
            allocatorData={allocatorData}
            onSetAllocatorAdapterId={setAllocatorAdapterId}
            onSetAllocatorAmount={setAllocatorAmount}
            onSetAllocatorData={setAllocatorData}
            onAllocate={() => void handleAllocatorAction('allocate')}
            onDeallocate={() => void handleAllocatorAction('deallocate')}
          />
        ) : null}
      </main>
    </div>
  );
}

export default App;
