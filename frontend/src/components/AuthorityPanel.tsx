import React from 'react';

export function AuthorityPanel(props: {
  pendingAction: string | null;
  trustlineEnabled: boolean;
  trustlineEngine: string;
  newAuthority: string;
  newCurator: string;
  newAllocator: string;
  addAdapterId: string;
  addAdapterProgram: string;
  addAdapterCap: string;
  addAdapterHoldingAddress: string;
  removeAdapterId: string;
  onSetNewAuthority: (value: string) => void;
  onSetNewCurator: (value: string) => void;
  onSetNewAllocator: (value: string) => void;
  onSetAddAdapterId: (value: string) => void;
  onSetAddAdapterProgram: (value: string) => void;
  onSetAddAdapterCap: (value: string) => void;
  onSetAddAdapterHoldingAddress: (value: string) => void;
  onSetRemoveAdapterId: (value: string) => void;
  onPause: () => void;
  onUnpause: () => void;
  onEnableTrustline: () => void;
  onDisableTrustline: () => void;
  onTransferAuthority: () => void;
  onSetRoles: () => void;
  onAddAdapter: () => void;
  onRemoveAdapter: () => void;
}) {
  const disabled = !!props.pendingAction;

  return (
    <section className="panel panel-gap">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Authority Panel</p>
          <h3>Emergency controls and role administration</h3>
        </div>
      </div>

      <div className="panel-grid three-up">
        <div className="subpanel">
          <h4>Pause controls</h4>
          <p className="helper-text">
            Use the authority wallet to freeze or resume investor actions instantly.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="primary-button"
              disabled={disabled}
              onClick={props.onPause}
            >
              Pause
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={props.onUnpause}
            >
              Unpause
            </button>
          </div>
        </div>

        <div className="subpanel">
          <h4>Trustline protection</h4>
          <p className="helper-text">
            Current status: <strong>{props.trustlineEnabled ? 'Enabled' : 'Disabled'}</strong>
          </p>
          <p className="helper-text">Validation engine: {props.trustlineEngine}</p>
          <div className="button-row">
            <button
              type="button"
              className="primary-button"
              disabled={disabled}
              onClick={props.onEnableTrustline}
            >
              Enable Trustline
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={props.onDisableTrustline}
            >
              Disable Trustline
            </button>
          </div>
        </div>

        <div className="subpanel">
          <h4>Transfer authority</h4>
          <input
            value={props.newAuthority}
            onChange={(event) => props.onSetNewAuthority(event.target.value)}
            placeholder="New authority pubkey"
          />
          <button
            type="button"
            className="primary-button"
            disabled={disabled}
            onClick={props.onTransferAuthority}
          >
            Transfer authority
          </button>
        </div>

        <div className="subpanel">
          <h4>Set roles</h4>
          <input
            value={props.newCurator}
            onChange={(event) => props.onSetNewCurator(event.target.value)}
            placeholder="Curator pubkey"
          />
          <input
            value={props.newAllocator}
            onChange={(event) => props.onSetNewAllocator(event.target.value)}
            placeholder="Allocator pubkey"
          />
          <button
            type="button"
            className="primary-button"
            disabled={disabled}
            onClick={props.onSetRoles}
          >
            Update roles
          </button>
        </div>

        <div className="subpanel">
          <h4>Add adapter</h4>
          <input
            value={props.addAdapterId}
            onChange={(event) => props.onSetAddAdapterId(event.target.value)}
            placeholder="Adapter id"
          />
          <input
            value={props.addAdapterProgram}
            onChange={(event) => props.onSetAddAdapterProgram(event.target.value)}
            placeholder="Adapter program pubkey"
          />
          <input
            value={props.addAdapterCap}
            onChange={(event) => props.onSetAddAdapterCap(event.target.value)}
            placeholder="Absolute cap in base units"
          />
          <input
            value={props.addAdapterHoldingAddress}
            onChange={(event) => props.onSetAddAdapterHoldingAddress(event.target.value)}
            placeholder="Adapter holding token account"
          />
          <button
            type="button"
            className="primary-button"
            disabled={disabled}
            onClick={props.onAddAdapter}
          >
            Register adapter
          </button>
        </div>

        <div className="subpanel">
          <h4>Remove adapter</h4>
          <input
            value={props.removeAdapterId}
            onChange={(event) => props.onSetRemoveAdapterId(event.target.value)}
            placeholder="Adapter id"
          />
          <button
            type="button"
            className="secondary-button"
            disabled={disabled}
            onClick={props.onRemoveAdapter}
          >
            Disable/remove adapter
          </button>
        </div>
      </div>
    </section>
  );
}
