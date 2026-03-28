import React from 'react';
import { ASSET_LABEL, SHARE_LABEL } from '../config';
import { formatUnits } from '../lib/svs13';
import { InvestorMode, InvestorPreview, VaultViewModel } from '../types';
import { StatTile } from './ui';

export function InvestorPanel(props: {
  vaultData: VaultViewModel | null;
  investorMode: InvestorMode;
  investorAmount: string;
  investorSlippage: string;
  ownershipBps: bigint;
  preview: InvestorPreview;
  canSubmitInvestor: boolean;
  connected: boolean;
  pendingAction: string | null;
  onSetInvestorMode: (mode: InvestorMode) => void;
  onSetInvestorAmount: (value: string) => void;
  onSetInvestorSlippage: (value: string) => void;
  onSubmit: () => void;
}) {
  const activeFlow =
    props.investorMode === 'deposit' || props.investorMode === 'mint'
      ? 'invest'
      : 'exit';

  const inputActionLabel =
    props.investorMode === 'deposit'
      ? 'You deposit'
      : props.investorMode === 'mint'
      ? 'You mint'
      : props.investorMode === 'withdraw'
      ? 'You withdraw'
      : 'You redeem';

  const resultActionLabel =
    props.investorMode === 'deposit' || props.investorMode === 'redeem'
      ? 'You get'
      : 'You spend';

  const isReverseFlow =
    props.investorMode === 'mint' || props.investorMode === 'withdraw';

  const toggleMode =
    props.investorMode === 'deposit'
      ? 'mint'
      : props.investorMode === 'mint'
      ? 'deposit'
      : props.investorMode === 'redeem'
      ? 'withdraw'
      : 'redeem';

  const toggleLabel =
    props.investorMode === 'deposit'
      ? 'Switch to Mint'
      : props.investorMode === 'mint'
      ? 'Switch to Deposit'
      : props.investorMode === 'redeem'
      ? 'Switch to Withdraw'
      : 'Switch to Redeem';

  const resultAmount =
    props.preview && !('error' in props.preview)
      ? props.investorMode === 'deposit' || props.investorMode === 'redeem'
        ? props.preview.receiveAmount
        : props.preview.payAmount
      : null;

  const resultLabel =
    props.preview && !('error' in props.preview)
      ? props.investorMode === 'deposit' || props.investorMode === 'redeem'
        ? props.preview.receiveLabel
        : props.preview.payLabel
      : '';

  const resultDecimals =
    resultLabel === ASSET_LABEL
      ? props.vaultData?.assetDecimals
      : resultLabel === SHARE_LABEL
      ? props.vaultData?.shareDecimals
      : undefined;

  return (
    <section className="panel panel-gap">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Investor Panel</p>
          <h3>Track your position, invest or redeem assets</h3>
        </div>
      </div>

      {props.vaultData ? (
        <>
          <div className="stats-grid">
            <StatTile
              label="Wallet asset balance"
              value={formatUnits(props.vaultData.userAssetBalance, props.vaultData.assetDecimals)}
              hint={ASSET_LABEL}
            />
            <StatTile
              label="Wallet shares"
              value={formatUnits(props.vaultData.userSharesBalance, props.vaultData.shareDecimals)}
              hint={SHARE_LABEL}
            />
            <StatTile
              label="Estimated position value"
              value={formatUnits(
                props.vaultData.userEstimatedAssets,
                props.vaultData.assetDecimals
              )}
              hint={ASSET_LABEL}
            />
            <StatTile
              label="Ownership"
              value={`${Number(props.ownershipBps) / 100}%`}
              hint="Share of vault supply"
            />
          </div>

          <div className="investor-grid">
            <div className="swap-card">
              <div className="swap-tabs">
                <button
                  type="button"
                  className={activeFlow === 'invest' ? 'active' : ''}
                  onClick={() => props.onSetInvestorMode('deposit')}
                >
                  Invest
                </button>
                <button
                  type="button"
                  className={activeFlow === 'exit' ? 'active' : ''}
                  onClick={() => props.onSetInvestorMode('redeem')}
                >
                  Exit
                </button>
              </div>

              <div className="swap-flow">
                <label className="swap-block">
                  <span>{inputActionLabel}</span>
                  <input
                    value={props.investorAmount}
                    onChange={(event) => props.onSetInvestorAmount(event.target.value)}
                    placeholder="0.0"
                  />
                  <strong>
                    {props.investorMode === 'deposit' || props.investorMode === 'withdraw'
                      ? ASSET_LABEL
                      : SHARE_LABEL}
                  </strong>
                </label>

                <button
                  type="button"
                  className="swap-arrow"
                  onClick={() => props.onSetInvestorMode(toggleMode)}
                  aria-label={toggleLabel}
                  title={toggleLabel}
                >
                  <svg
                    viewBox="0 0 48 48"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className={`swap-arrow-icon ${isReverseFlow ? 'reverse' : ''}`}
                  >
                    <path
                      d="M24 10V31"
                      stroke="currentColor"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M15 24L24 33L33 24"
                      stroke="currentColor"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle
                      cx="24"
                      cy="24"
                      r="22"
                      stroke="rgba(255,255,255,0.15)"
                      strokeWidth="1.5"
                    />
                  </svg>
                </button>

                <div className="swap-block result">
                  <span>{resultActionLabel}</span>
                  <div className="swap-result-value">
                    {props.preview && 'error' in props.preview
                      ? props.preview.error
                      : props.preview && props.vaultData && resultAmount !== null && resultDecimals !== undefined
                      ? formatUnits(
                          resultAmount,
                          resultDecimals
                        )
                      : '0'}
                  </div>
                  <strong>{resultLabel}</strong>
                </div>
              </div>

              <div className="swap-meta">
                <label>
                  Slippage (bps)
                  <input
                    value={props.investorSlippage}
                    onChange={(event) => props.onSetInvestorSlippage(event.target.value)}
                  />
                </label>
                <div className="helper-text">
                  {props.preview && !('error' in props.preview) ? (
                    <>
                      {props.preview.minMaxLabel}:{' '}
                      {formatUnits(
                        props.preview.minMaxAmount,
                        props.preview.receiveLabel === ASSET_LABEL
                          ? props.vaultData.assetDecimals
                          : props.vaultData.shareDecimals
                      )}
                    </>
                  ) : (
                    'Quotes update locally from the vault state.'
                  )}
                </div>
              </div>

              <button
                type="button"
                className="primary-button"
                onClick={props.onSubmit}
                disabled={!props.canSubmitInvestor}
              >
                {props.pendingAction ===
                props.investorMode.charAt(0).toUpperCase() + props.investorMode.slice(1)
                  ? 'Submitting...'
                  : props.connected
                  ? `Submit ${props.investorMode}`
                  : 'Connect wallet to interact'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="empty-state">Load a valid vault to access investor actions.</div>
      )}
    </section>
  );
}
