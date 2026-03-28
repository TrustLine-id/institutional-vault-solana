import React from 'react';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ASSET_LABEL } from '../config';
import {
  TOKEN_2022_PROGRAM_ID as SVS_TOKEN_2022_PROGRAM_ID,
  humanizeAddress,
} from '../lib/svs13';
import { VaultViewModel } from '../types';
import { DetailRow } from './ui';

export function AllocatorPanel(props: {
  vaultData: VaultViewModel | null;
  pendingAction: string | null;
  allocatorAdapterId: string;
  allocatorAmount: string;
  allocatorData: string;
  onSetAllocatorAdapterId: (value: string) => void;
  onSetAllocatorAmount: (value: string) => void;
  onSetAllocatorData: (value: string) => void;
  onAllocate: () => void;
  onDeallocate: () => void;
}) {
  const disabled = !!props.pendingAction;
  const selectedAdapter = props.vaultData?.adapters.find(
    (adapter) => adapter.id.toString() === props.allocatorAdapterId.trim()
  );

  return (
    <section className="panel panel-gap">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Allocator Panel</p>
          <h3>Move capital between idle liquidity and adapters</h3>
        </div>
      </div>

      <div className="panel-grid two-up">
        <div className="subpanel">
          <h4>Allocate or deallocate</h4>
          <input
            value={props.allocatorAdapterId}
            onChange={(event) => props.onSetAllocatorAdapterId(event.target.value)}
            placeholder="Adapter id"
          />
          <input
            value={props.allocatorAmount}
            onChange={(event) => props.onSetAllocatorAmount(event.target.value)}
            placeholder={`Amount in ${ASSET_LABEL}`}
          />
          <textarea
            value={props.allocatorData}
            onChange={(event) => props.onSetAllocatorData(event.target.value)}
            placeholder="Optional adapter data (utf-8 or 0x-prefixed hex)"
          />
          <div className="button-row">
            <button
              type="button"
              className="primary-button"
              disabled={disabled}
              onClick={props.onAllocate}
            >
              Allocate
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={props.onDeallocate}
            >
              Deallocate
            </button>
          </div>
        </div>

        <div className="subpanel">
          <h4>Allocator notes</h4>
          <DetailRow
            label="Asset token program"
            value={
              props.vaultData
                ? props.vaultData.assetTokenProgram.equals(TOKEN_PROGRAM_ID)
                  ? 'SPL Token'
                  : props.vaultData.assetTokenProgram.equals(SVS_TOKEN_2022_PROGRAM_ID)
                  ? 'Token-2022'
                  : humanizeAddress(props.vaultData.assetTokenProgram)
                : 'Unknown'
            }
          />
          <DetailRow
            label="Asset vault"
            value={
              props.vaultData
                ? humanizeAddress(props.vaultData.vault.assetVault)
                : 'Unavailable'
            }
          />
          <DetailRow
            label="Resolved holding"
            value={
              selectedAdapter
                ? humanizeAddress(selectedAdapter.holdingAddress)
                : 'Enter a registered adapter id'
            }
          />
          <DetailRow
            label="Instruction data"
            value="Leave blank for the fake/stub adapter path."
          />
          <DetailRow
            label="Holding source"
            value="Resolved automatically from the on-chain adapter registry."
          />
        </div>
      </div>
    </section>
  );
}
