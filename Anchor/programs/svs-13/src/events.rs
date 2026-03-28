//! Vault events emitted on state changes.

use anchor_lang::prelude::*;

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub asset_mint: Pubkey,
    pub shares_mint: Pubkey,
    pub vault_id: u64,
}

#[event]
pub struct Deposit {
    pub vault: Pubkey,
    pub caller: Pubkey,
    pub owner: Pubkey,
    pub assets: u64,
    pub shares: u64,
}

#[event]
pub struct Withdraw {
    pub vault: Pubkey,
    pub caller: Pubkey,
    pub receiver: Pubkey,
    pub owner: Pubkey,
    pub assets: u64,
    pub shares: u64,
}

#[event]
pub struct VaultSynced {
    pub vault: Pubkey,
    pub previous_total: u64,
    pub new_total: u64,
}

#[event]
pub struct VaultStatusChanged {
    pub vault: Pubkey,
    pub paused: bool,
}

#[event]
pub struct AuthorityTransferred {
    pub vault: Pubkey,
    pub previous_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct TrustlineConfigUpdated {
    pub vault: Pubkey,
    pub validation_engine: Pubkey,
    pub enabled: bool,
}

// =========================
// Adapter registry events
// =========================

#[event]
pub struct AdapterAdded {
    pub vault: Pubkey,
    pub adapter_id: u64,
    pub adapter_program: Pubkey,
}

#[event]
pub struct AdapterRemoved {
    pub vault: Pubkey,
    pub adapter_id: u64,
}

#[event]
pub struct AdapterEnabled {
    pub vault: Pubkey,
    pub adapter_id: u64,
    pub enabled: bool,
}

#[event]
pub struct AdapterCapUpdated {
    pub vault: Pubkey,
    pub adapter_id: u64,
    pub max_allocation_abs: u64,
}

#[event]
pub struct RolesUpdated {
    pub vault: Pubkey,
    pub curator: Pubkey,
    pub allocator: Pubkey,
}

#[event]
pub struct LiquidityAdapterUpdated {
    pub vault: Pubkey,
    pub liquidity_adapter_id: u64, // 0 means disabled
}

// =========================
// Allocation events
// =========================

#[event]
pub struct AllocateEvent {
    pub vault: Pubkey,
    pub adapter_id: u64,
    pub amount: u64,
}

#[event]
pub struct DeallocateEvent {
    pub vault: Pubkey,
    pub adapter_id: u64,
    pub amount: u64,
}

#[event]
pub struct NavSyncEvent {
    pub vault: Pubkey,
    pub total_assets: u64,
    pub idle_assets: u64,
}
