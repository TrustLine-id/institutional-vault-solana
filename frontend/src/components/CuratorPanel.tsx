import React from 'react';

export function CuratorPanel(props: {
  pendingAction: string | null;
  liquidityAdapterId: string;
  capAdapterId: string;
  capAmount: string;
  enableAdapterId: string;
  disableAdapterId: string;
  onSetLiquidityAdapterId: (value: string) => void;
  onSetCapAdapterId: (value: string) => void;
  onSetCapAmount: (value: string) => void;
  onSetEnableAdapterId: (value: string) => void;
  onSetDisableAdapterId: (value: string) => void;
  onSync: () => void;
  onSetLiquidityAdapter: () => void;
  onSetAdapterCap: () => void;
  onEnableAdapter: () => void;
  onDisableAdapter: () => void;
}) {
  const disabled = !!props.pendingAction;

  return (
    <section className="panel panel-gap">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Curator Panel</p>
          <h3>Risk management, NAV sync, and adapter policy</h3>
        </div>
      </div>

      <div className="panel-grid three-up">
        <div className="subpanel">
          <h4>Sync total assets</h4>
          <p className="helper-text">
            Uses the vault's registered on-chain adapter configs and forwards their
            `(adapter_config, adapter_position, adapter_holding)` accounts.
          </p>
          <button
            type="button"
            className="primary-button"
            disabled={disabled}
            onClick={props.onSync}
          >
            Run sync_total_assets
          </button>
        </div>

        <div className="subpanel">
          <h4>Liquidity adapter</h4>
          <input
            value={props.liquidityAdapterId}
            onChange={(event) => props.onSetLiquidityAdapterId(event.target.value)}
            placeholder="0 disables the liquidity adapter"
          />
          <button
            type="button"
            className="primary-button"
            disabled={disabled}
            onClick={props.onSetLiquidityAdapter}
          >
            Set liquidity adapter
          </button>
        </div>

        <div className="subpanel">
          <h4>Adapter cap</h4>
          <input
            value={props.capAdapterId}
            onChange={(event) => props.onSetCapAdapterId(event.target.value)}
            placeholder="Adapter id"
          />
          <input
            value={props.capAmount}
            onChange={(event) => props.onSetCapAmount(event.target.value)}
            placeholder="Cap in base units"
          />
          <button
            type="button"
            className="primary-button"
            disabled={disabled}
            onClick={props.onSetAdapterCap}
          >
            Update cap
          </button>
        </div>

        <div className="subpanel">
          <h4>Enable adapter</h4>
          <input
            value={props.enableAdapterId}
            onChange={(event) => props.onSetEnableAdapterId(event.target.value)}
            placeholder="Adapter id"
          />
          <button
            type="button"
            className="primary-button"
            disabled={disabled}
            onClick={props.onEnableAdapter}
          >
            Enable adapter
          </button>
        </div>

        <div className="subpanel">
          <h4>Disable adapter</h4>
          <input
            value={props.disableAdapterId}
            onChange={(event) => props.onSetDisableAdapterId(event.target.value)}
            placeholder="Adapter id"
          />
          <button
            type="button"
            className="secondary-button"
            disabled={disabled}
            onClick={props.onDisableAdapter}
          >
            Disable adapter
          </button>
        </div>
      </div>
    </section>
  );
}
