//! Program constants: PDA seeds, limits, and decimals configuration.

pub const VAULT_SEED: &[u8] = b"vault";
pub const SHARES_MINT_SEED: &[u8] = b"shares";

pub const MAX_DECIMALS: u8 = 9;
pub const SHARES_DECIMALS: u8 = 9;

pub const MIN_DEPOSIT_AMOUNT: u64 = 1000;

// =============================================================================
// SVS-13 Adapter registry PDAs
// =============================================================================

pub const ADAPTER_CONFIG_SEED: &[u8] = b"adapter_config";
pub const ADAPTER_POSITION_SEED: &[u8] = b"adapter_position";

// Adapter authority PDA seed (used to derive adapter-controlled holding accounts).
// Token account authority is expected to be a PDA derived under the adapter program.
pub const ADAPTER_AUTHORITY_SEED: &[u8] = b"adapter_authority";
