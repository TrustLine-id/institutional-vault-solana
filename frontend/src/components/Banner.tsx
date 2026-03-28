import React from 'react';
import { EXPLORER_CLUSTER } from '../config';
import { BannerState } from '../types';

export function Banner(props: { banner: BannerState | null }) {
  if (!props.banner) {
    return null;
  }

  return (
    <div className={`banner ${props.banner.tone}`}>
      <div>
        <strong>{props.banner.message}</strong>
        {props.banner.signature ? (
          <a
            href={`https://explorer.solana.com/tx/${props.banner.signature}?cluster=${EXPLORER_CLUSTER}`}
            target="_blank"
            rel="noreferrer"
          >
            View transaction
          </a>
        ) : null}
      </div>
    </div>
  );
}
