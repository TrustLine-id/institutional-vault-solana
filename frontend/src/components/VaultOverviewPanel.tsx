import React, { useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import {
  ASSET_LABEL,
  EXPLORER_CLUSTER,
  NETWORK_LABEL,
  SHARE_LABEL,
  VAULT_ADDRESS,
} from '../config';
import { formatUnits, humanizeAddress } from '../lib/svs13';
import { RoleFlags, VaultViewModel } from '../types';
import { VaultHeroCard } from './VaultHeroCard';
import { DetailRow, RoleBadge, StatTile } from './ui';

export function VaultOverviewPanel(props: {
  loading: boolean;
  refreshing: boolean;
  vaultData: VaultViewModel | null;
  roleFlags: RoleFlags;
  sharePriceBase: bigint;
  vaultAddress: PublicKey | null;
  programId: PublicKey | null;
  onRefresh: () => void;
}) {
  const vaultData = props.vaultData;
  const [isVaultDetailsOpen, setIsVaultDetailsOpen] = useState(false);

  return (
    <>
      <VaultHeroCard refreshing={props.refreshing} onRefresh={props.onRefresh} />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Vault Overview</p>
            <h3>Core state and live positioning</h3>
          </div>
          {vaultData ? (
            <div className="role-strip">
              {props.roleFlags.authority || props.roleFlags.curator || props.roleFlags.allocator ? (
                <>
                  {props.roleFlags.authority ? <RoleBadge label="Authority" /> : null}
                  {props.roleFlags.curator ? <RoleBadge label="Curator" /> : null}
                  {props.roleFlags.allocator ? <RoleBadge label="Allocator" /> : null}
                </>
              ) : (
                <RoleBadge label="Investor" />
              )}
            </div>
          ) : null}
        </div>

        {props.loading ? (
          <div className="empty-state">Loading vault state...</div>
        ) : !vaultData ? (
          <div className="empty-state">
            Set a valid `src/config.ts` vault address and make sure the account exists on
            {` ${NETWORK_LABEL}.`}
          </div>
        ) : (
          <>
            <div className="stats-grid">
              <StatTile
                label="Total AUM"
                value={formatUnits(vaultData.vault.totalAssets, vaultData.assetDecimals)}
                hint={ASSET_LABEL}
              />
              <StatTile
                label="Idle Liquidity"
                value={formatUnits(vaultData.idleAssets, vaultData.assetDecimals)}
                hint="Withdrawable now"
              />
              <StatTile
                label="Share Supply"
                value={formatUnits(vaultData.shareSupply, vaultData.shareDecimals)}
                hint={SHARE_LABEL}
              />
              <StatTile
                label="Price per Share"
                value={formatUnits(props.sharePriceBase, vaultData.assetDecimals, 6)}
                hint={`${ASSET_LABEL} per share`}
              />
            </div>

            <div className="panel-grid">
              <div className="subpanel vault-details-card">
                <div className="subpanel-header">
                  <h4>Details</h4>
                  <button
                    type="button"
                    className="ghost-button icon-toggle-button"
                    onClick={() => setIsVaultDetailsOpen((previous) => !previous)}
                    aria-expanded={isVaultDetailsOpen}
                    aria-label={isVaultDetailsOpen ? 'Hide vault details' : 'Show vault details'}
                    title={isVaultDetailsOpen ? 'Hide vault details' : 'Show vault details'}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className={`collapse-arrow ${isVaultDetailsOpen ? 'open' : ''}`}
                      aria-hidden="true"
                    >
                      <path
                        d="M6 9L12 15L18 9"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
                {isVaultDetailsOpen ? (
                  <div className="vault-details-layout">
                    <div className="vault-details-list">
                      <div className="vault-section-heading">
                        <p className="eyebrow">Vault details</p>
                      </div>
                      <DetailRow
                        label="Vault address"
                        value={
                          <a
                            href={`https://explorer.solana.com/address/${VAULT_ADDRESS}?cluster=${EXPLORER_CLUSTER}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {humanizeAddress(props.vaultAddress)}
                          </a>
                        }
                      />
                      <DetailRow label="Program" value={humanizeAddress(props.programId)} />
                      <DetailRow
                        label="Authority"
                        value={humanizeAddress(vaultData.vault.authority)}
                      />
                      <DetailRow
                        label="Curator"
                        value={humanizeAddress(vaultData.vault.curator)}
                      />
                      <DetailRow
                        label="Allocator"
                        value={humanizeAddress(vaultData.vault.allocator)}
                      />
                      <DetailRow
                        label="Asset mint"
                        value={humanizeAddress(vaultData.vault.assetMint)}
                      />
                      <DetailRow
                        label="Asset vault"
                        value={humanizeAddress(vaultData.vault.assetVault)}
                      />
                      <DetailRow
                        label="Shares mint"
                        value={humanizeAddress(vaultData.vault.sharesMint)}
                      />
                      <DetailRow
                        label="Liquidity adapter"
                        value={vaultData.vault.liquidityAdapterId?.toString() ?? 'None'}
                      />
                      <DetailRow
                        label="Paused"
                        value={vaultData.vault.paused ? 'Yes' : 'No'}
                      />
                      <DetailRow
                        label="Trustline protection"
                        value={vaultData.vault.trustlineEnabled ? 'Enabled' : 'Disabled'}
                      />
                      {vaultData.vault.trustlineEnabled ? (
                        <DetailRow
                          label="Validation engine"
                          value={humanizeAddress(vaultData.vault.validationEngine)}
                        />
                      ) : null}
                      <DetailRow
                        label="Last sync slot"
                        value={vaultData.vault.lastSyncSlot.toString()}
                      />
                    </div>

                    <div className="vault-adapters-pane">
                      <div className="vault-section-heading">
                        <p className="eyebrow">Registered adapters</p>
                      </div>

                      <div className="adapter-snapshots">
                        {vaultData.adapters.length === 0 ? (
                          <div className="helper-text">
                            No adapter configs were discovered on-chain for this vault yet.
                          </div>
                        ) : (
                          vaultData.adapters.map((adapter) => (
                            <div
                              className={`adapter-snapshot ${adapter.config?.enabled ? '' : 'disabled'}`}
                              key={adapter.id.toString()}
                            >
                              <div className="adapter-snapshot-title">
                                <strong>Adapter #{adapter.id.toString()}</strong>
                                <span>
                                  {adapter.config?.enabled ? 'Enabled' : 'Unknown / disabled'}
                                </span>
                              </div>
                              <DetailRow
                                label="Holding"
                                value={humanizeAddress(adapter.holdingAddress)}
                              />
                              <DetailRow
                                label="Cap"
                                value={
                                  adapter.config
                                    ? formatUnits(
                                        adapter.config.maxAllocationAbs,
                                        vaultData.assetDecimals
                                      )
                                    : 'N/A'
                                }
                              />
                              <DetailRow
                                label="Principal deployed"
                                value={
                                  adapter.position
                                    ? formatUnits(
                                        adapter.position.principalDeployed,
                                        vaultData.assetDecimals
                                      )
                                    : 'N/A'
                                }
                              />
                              <DetailRow
                                label="Reported assets"
                                value={
                                  adapter.position
                                    ? formatUnits(
                                        adapter.position.lastReportedAssets,
                                        vaultData.assetDecimals
                                      )
                                    : 'N/A'
                                }
                              />
                              <DetailRow
                                label="Holding balance"
                                value={
                                  adapter.holdingBalance !== null
                                    ? formatUnits(
                                        adapter.holdingBalance,
                                        vaultData.assetDecimals
                                      )
                                    : 'Unavailable'
                                }
                              />
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}
