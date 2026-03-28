import React from 'react';
import {
  EXPLORER_CLUSTER,
  PROGRAM_ID,
  VAULT_ADDRESS,
  VAULT_LABEL,
} from '../config';

export function VaultHeroCard(props: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="hero-card">
      <div>
        <h2>{VAULT_LABEL}</h2>
        <p className="hero-copy">
          A permissioned & insured institutional-grade vault powered by Trustline. Trustline enforces compliance to investor flows and security to every admin action. It works with any custodian.
        </p>
      </div>
      <div className="hero-links">
        <a
          href={`https://explorer.solana.com/address/${VAULT_ADDRESS}?cluster=${EXPLORER_CLUSTER}`}
          target="_blank"
          rel="noreferrer"
        >
          Vault on Explorer
        </a>
        <a
          href={`https://explorer.solana.com/address/${PROGRAM_ID}?cluster=${EXPLORER_CLUSTER}`}
          target="_blank"
          rel="noreferrer"
        >
          Program on Explorer
        </a>
        <button
          type="button"
          className="ghost-button"
          onClick={props.onRefresh}
          disabled={props.refreshing}
        >
          {props.refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </section>
  );
}
