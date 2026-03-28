//! Vault state account definition.

use anchor_lang::prelude::*;

use crate::constants::VAULT_SEED;

#[account]
pub struct Vault {
    /// Vault admin who can pause/unpause and transfer authority
    pub authority: Pubkey,
    /// Curator role (risk manager) - updates NAV via sync_total_assets
    pub curator: Pubkey,
    /// Allocator role (execution) - allocates/deallocates adapter positions
    pub allocator: Pubkey,
    /// Underlying asset mint
    pub asset_mint: Pubkey,
    /// LP token mint (shares)
    pub shares_mint: Pubkey,
    /// Token account holding assets
    pub asset_vault: Pubkey,
    /// Cached total assets (updated on deposit/withdraw, can be synced)
    pub total_assets: u64,
    /// Virtual offset exponent (9 - asset_decimals) for inflation attack protection
    pub decimals_offset: u8,
    /// PDA bump seed
    pub bump: u8,
    /// Emergency pause flag
    pub paused: bool,
    /// Unique vault identifier (allows multiple vaults per asset)
    pub vault_id: u64,

    /// Liquidity adapter id (0 = none; adapter id must be non-zero)
    pub liquidity_adapter_id: Option<u64>,

    /// Max number of adapters configured for this vault
    pub max_adapters: u8,
    /// Current number of adapters
    pub num_adapters: u8,
    /// Last adapter NAV sync slot
    pub last_sync_slot: u64,
    /// Trustline validation engine program allowed to protect this vault
    pub validation_engine: Pubkey,
    /// Whether Trustline enforcement is active for protected instructions
    pub trustline_enabled: bool,

    /// Reserved for future upgrades
    pub _reserved: [u8; 31],
}

impl Vault {
    pub const LEN: usize = 8 +  // discriminator
        32 +  // authority
        32 +  // curator
        32 +  // allocator
        32 +  // asset_mint
        32 +  // shares_mint
        32 +  // asset_vault
        8 +   // total_assets
        1 +   // decimals_offset
        1 +   // bump
        1 +   // paused
        8 +   // vault_id
        9 +   // liquidity_adapter_id: Option<u64> (1 tag + u64)
        1 +   // max_adapters
        1 +   // num_adapters
        8 +   // last_sync_slot
        32 +  // validation_engine
        1 +   // trustline_enabled
        31; // _reserved

    pub const SEED_PREFIX: &'static [u8] = VAULT_SEED;
}

// =============================================================================
// Adapter Registry Accounts
// =============================================================================

#[account]
pub struct AdapterConfig {
    pub vault: Pubkey,
    pub adapter_id: u64,
    pub adapter_program: Pubkey,
    pub enabled: bool,
    pub max_allocation_abs: u64, // 0 = no cap
    pub holding_account: Pubkey,
    pub name: [u8; 32],
    pub bump: u8,
    pub _reserved: [u8; 32],
}

impl AdapterConfig {
    pub const LEN: usize = 8 +   // discriminator
        32 +  // vault
        8 +   // adapter_id
        32 +  // adapter_program
        1 +   // enabled
        8 +   // max_allocation_abs
        32 +  // holding_account
        32 +  // name
        1 +   // bump
        32; // _reserved
}

#[account]
pub struct AdapterPosition {
    pub vault: Pubkey,
    pub adapter_id: u64,
    pub principal_deployed: u64,
    pub last_reported_assets: u64,
    pub last_reported_slot: u64,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

impl AdapterPosition {
    pub const LEN: usize = 8 +   // discriminator
        32 +  // vault
        8 +   // adapter_id
        8 +   // principal_deployed
        8 +   // last_reported_assets
        8 +   // last_reported_slot
        1 +   // bump
        32; // _reserved
}

// =============================================================================
// Access Mode (always available for IDL generation)
// =============================================================================

/// Access mode enum - always exported for IDL compatibility.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum AccessMode {
    /// Open access - anyone can interact
    #[default]
    Open,
    /// Whitelist - only addresses with valid merkle proofs
    Whitelist,
    /// Blacklist - anyone except addresses with valid merkle proofs
    Blacklist,
}

// =============================================================================
// Module State Accounts (conditionally compiled with "modules" feature)
// =============================================================================

#[cfg(feature = "modules")]
pub mod module_state {
    use super::*;

    pub use svs_module_hooks::{
        ACCESS_CONFIG_SEED, CAP_CONFIG_SEED, FEE_CONFIG_SEED, FROZEN_ACCOUNT_SEED,
        LOCK_CONFIG_SEED, REWARD_CONFIG_SEED, SHARE_LOCK_SEED, USER_DEPOSIT_SEED, USER_REWARD_SEED,
    };

    #[account]
    pub struct FeeConfig {
        pub vault: Pubkey,
        pub fee_recipient: Pubkey,
        pub entry_fee_bps: u16,
        pub exit_fee_bps: u16,
        pub management_fee_bps: u16,
        pub performance_fee_bps: u16,
        pub high_water_mark: u64,
        pub last_fee_collection: i64,
        pub bump: u8,
    }

    impl FeeConfig {
        pub const LEN: usize = 8 + 32 + 32 + 2 + 2 + 2 + 2 + 8 + 8 + 1;
    }

    #[account]
    pub struct CapConfig {
        pub vault: Pubkey,
        pub global_cap: u64,
        pub per_user_cap: u64,
        pub bump: u8,
    }

    impl CapConfig {
        pub const LEN: usize = 8 + 32 + 8 + 8 + 1;
    }

    #[account]
    pub struct UserDeposit {
        pub vault: Pubkey,
        pub user: Pubkey,
        pub cumulative_assets: u64,
        pub bump: u8,
    }

    impl UserDeposit {
        pub const LEN: usize = 8 + 32 + 32 + 8 + 1;
    }

    #[account]
    pub struct LockConfig {
        pub vault: Pubkey,
        pub lock_duration: i64,
        pub bump: u8,
    }

    impl LockConfig {
        pub const LEN: usize = 8 + 32 + 8 + 1;
    }

    #[account]
    pub struct ShareLock {
        pub vault: Pubkey,
        pub owner: Pubkey,
        pub locked_until: i64,
        pub bump: u8,
    }

    impl ShareLock {
        pub const LEN: usize = 8 + 32 + 32 + 8 + 1;
    }

    #[account]
    pub struct AccessConfig {
        pub vault: Pubkey,
        pub mode: super::AccessMode,
        pub merkle_root: [u8; 32],
        pub bump: u8,
    }

    impl AccessConfig {
        pub const LEN: usize = 8 + 32 + 1 + 32 + 1;
    }

    #[account]
    pub struct FrozenAccount {
        pub vault: Pubkey,
        pub user: Pubkey,
        pub frozen_by: Pubkey,
        pub frozen_at: i64,
        pub bump: u8,
    }

    impl FrozenAccount {
        pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 1;
    }

    #[account]
    pub struct RewardConfig {
        pub vault: Pubkey,
        pub reward_mint: Pubkey,
        pub reward_vault: Pubkey,
        pub reward_authority: Pubkey,
        pub accumulated_per_share: u128,
        pub last_update: i64,
        pub bump: u8,
    }

    impl RewardConfig {
        pub const LEN: usize = 8 + 32 + 32 + 32 + 32 + 16 + 8 + 1;
    }

    #[account]
    pub struct UserReward {
        pub vault: Pubkey,
        pub user: Pubkey,
        pub reward_mint: Pubkey,
        pub reward_debt: u128,
        pub unclaimed: u64,
        pub bump: u8,
    }

    impl UserReward {
        pub const LEN: usize = 8 + 32 + 32 + 32 + 16 + 8 + 1;
    }
}

#[cfg(feature = "modules")]
pub use module_state::*;
