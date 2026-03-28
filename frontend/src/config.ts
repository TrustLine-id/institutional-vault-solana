import { clusterApiUrl } from '@solana/web3.js';

export const APP_TITLE = 'Institutional Vault';
export const NETWORK_LABEL = 'devnet';
export const RPC_ENDPOINT =
  process.env.REACT_APP_RPC_URL || clusterApiUrl('devnet');

export const PROGRAM_ID =
  process.env.REACT_APP_SVS13_PROGRAM_ID ||
  '5jZj4Xh36vgk2SYDXXaqMJWwZCn3v9n7kHziPwyrRGDk';

// Demo vault initialized on devnet via scripts/init-svs13-devnet.ts.
export const VAULT_ADDRESS =
  process.env.REACT_APP_SVS13_VAULT_ADDRESS ||
  '2PjyZ8J6dJ2c6BBQVZDBeCVK2MNU1pLXb39XEgBHwPm3';

export const VAULT_LABEL = 'AMINA USDC Demo Vault';
export const ASSET_LABEL = 'USDC';
export const SHARE_LABEL = 'svUSDC';

export const EXPLORER_CLUSTER = 'devnet';

export const TRUSTLINE_API_URL =
  process.env.REACT_APP_TRUSTLINE_API_URL || 'https://api.trustline.id/api/v0';
export const TRUSTLINE_CLIENT_ID =
  process.env.REACT_APP_TRUSTLINE_CLIENT_ID || '00000000000000000000000000000000';
export const TRUSTLINE_CHAIN_ID = process.env.REACT_APP_TRUSTLINE_CHAIN_ID || '103';
export const TRUSTLINE_VALIDATION_MODE =
  process.env.REACT_APP_TRUSTLINE_VALIDATION_MODE || null;
export const TRUSTLINE_APPROVAL_REQUIRED =
  process.env.REACT_APP_TRUSTLINE_APPROVAL_REQUIRED === 'true';
