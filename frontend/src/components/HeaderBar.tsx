import React from 'react';
import { PublicKey } from '@solana/web3.js';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { APP_TITLE, NETWORK_LABEL } from '../config';

export function HeaderBar(props: { publicKey: PublicKey | null }) {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <p className="eyebrow">StableHacks 2026</p>
        <div className="topbar-title-row">
          <span className="solana-mark" aria-hidden="true">
            <svg viewBox="0 0 397.7 311.7" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient
                  id="solanaHeaderGradientTop"
                  gradientUnits="userSpaceOnUse"
                  x1="360.8791"
                  y1="351.4553"
                  x2="141.213"
                  y2="-69.2936"
                  gradientTransform="matrix(1 0 0 -1 0 314)"
                >
                  <stop offset="0" stopColor="#00FFA3" />
                  <stop offset="1" stopColor="#DC1FFF" />
                </linearGradient>
                <linearGradient
                  id="solanaHeaderGradientMiddle"
                  gradientUnits="userSpaceOnUse"
                  x1="264.8291"
                  y1="401.6014"
                  x2="45.163"
                  y2="-19.1475"
                  gradientTransform="matrix(1 0 0 -1 0 314)"
                >
                  <stop offset="0" stopColor="#00FFA3" />
                  <stop offset="1" stopColor="#DC1FFF" />
                </linearGradient>
                <linearGradient
                  id="solanaHeaderGradientBottom"
                  gradientUnits="userSpaceOnUse"
                  x1="312.5484"
                  y1="376.688"
                  x2="92.8822"
                  y2="-44.061"
                  gradientTransform="matrix(1 0 0 -1 0 314)"
                >
                  <stop offset="0" stopColor="#00FFA3" />
                  <stop offset="1" stopColor="#DC1FFF" />
                </linearGradient>
              </defs>
              <path
                d="M64.6 237.9C67 235.5 70.3 234.1 73.8 234.1H391.2C397 234.1 399.9 241.1 395.8 245.2L333.1 307.9C330.7 310.3 327.4 311.7 323.9 311.7H6.5C0.7 311.7 -2.2 304.7 1.9 300.6L64.6 237.9Z"
                fill="url(#solanaHeaderGradientTop)"
              />
              <path
                d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0H391.2C397 0 399.9 7 395.8 11.1L333.1 73.8C330.7 76.2 327.4 77.6 323.9 77.6H6.5C0.7 77.6 -2.2 70.6 1.9 66.5L64.6 3.8Z"
                fill="url(#solanaHeaderGradientMiddle)"
              />
              <path
                d="M333.1 120.1C330.7 117.7 327.4 116.3 323.9 116.3H6.5C0.7 116.3 -2.2 123.3 1.9 127.4L64.6 190.1C67 192.5 70.3 193.9 73.8 193.9H391.2C397 193.9 399.9 186.9 395.8 182.8L333.1 120.1Z"
                fill="url(#solanaHeaderGradientBottom)"
              />
            </svg>
          </span>
          <h1>{APP_TITLE}</h1>
        </div>
        <div className="topbar-badges">
          <span className="network-pill">{NETWORK_LABEL.toUpperCase()}</span>
          <span className="network-pill">Powered by Trustline</span>
        </div>
      </div>
      <div className="topbar-wallet">
        <WalletMultiButton />
      </div>
    </header>
  );
}
