//! SVS-13: Adapter Vault (starting baseline = SVS-2 stored balance)
//!
//! For now, SVS-13 is a copy of SVS-2 to establish the program skeleton and
//! ensure it builds. SVS-13 adapter allocation + CPI-based NAV sync will be
//! implemented incrementally on top of this baseline.

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;
pub mod trustline;

use instructions::*;

// Temporary placeholder program id (will be replaced when SVS-13 is deployed)
declare_id!("5jZj4Xh36vgk2SYDXXaqMJWwZCn3v9n7kHziPwyrRGDk");

#[program]
pub mod svs_13 {
    use super::*;

    /// Initialize a new vault for the given asset
    pub fn initialize(
        ctx: Context<Initialize>,
        vault_id: u64,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, vault_id, name, symbol, uri)
    }

    /// Deposit assets and receive shares
    /// Returns shares minted (floor rounding - favors vault)
    pub fn deposit<'info>(
        ctx: Context<'_, '_, '_, 'info, Deposit<'info>>,
        assets: u64,
        min_shares_out: u64,
    ) -> Result<()> {
        instructions::deposit::handler(ctx, assets, min_shares_out)
    }

    /// Mint exact shares by depositing required assets
    /// Pays assets (ceiling rounding - favors vault)
    pub fn mint<'info>(
        ctx: Context<'_, '_, '_, 'info, MintShares<'info>>,
        shares: u64,
        max_assets_in: u64,
    ) -> Result<()> {
        instructions::mint::handler(ctx, shares, max_assets_in)
    }

    /// Withdraw exact assets by burning required shares
    /// Burns shares (ceiling rounding - favors vault)
    pub fn withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>,
        assets: u64,
        max_shares_in: u64,
    ) -> Result<()> {
        instructions::withdraw::handler(ctx, assets, max_shares_in)
    }

    /// Redeem shares for assets
    /// Receives assets (floor rounding - favors vault)
    pub fn redeem<'info>(
        ctx: Context<'_, '_, '_, 'info, Redeem<'info>>,
        shares: u64,
        min_assets_out: u64,
    ) -> Result<()> {
        instructions::redeem::handler(ctx, shares, min_assets_out)
    }

    /// Pause all vault operations (emergency)
    pub fn pause<'info>(ctx: Context<'_, '_, '_, 'info, Admin<'info>>) -> Result<()> {
        instructions::admin::pause(ctx)
    }

    /// Unpause vault operations
    pub fn unpause<'info>(ctx: Context<'_, '_, '_, 'info, Admin<'info>>) -> Result<()> {
        instructions::admin::unpause(ctx)
    }

    /// Transfer vault authority
    pub fn transfer_authority<'info>(
        ctx: Context<'_, '_, '_, 'info, Admin<'info>>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::admin::transfer_authority(ctx, new_authority)
    }

    /// Configure whether this vault enforces Trustline validations.
    pub fn set_trustline_config(
        ctx: Context<Admin>,
        validation_engine: Pubkey,
        enabled: bool,
    ) -> Result<()> {
        instructions::admin::set_trustline_config(ctx, validation_engine, enabled)
    }

    /// Sync total_assets (NAV) using adapters and cached idle.
    pub fn sync_total_assets(ctx: Context<SyncTotalAssets>, adapter_ids: Vec<u64>) -> Result<()> {
        instructions::admin::sync_total_assets(ctx, adapter_ids)
    }

    // ============ Adapter Admin (curator/authority) ============

    /// Add and register a new adapter.
    pub fn add_adapter(
        ctx: Context<AddAdapter>,
        adapter_id: u64,
        adapter_program: Pubkey,
        max_allocation_abs: u64,
    ) -> Result<()> {
        instructions::adapter_admin::add_adapter(
            ctx,
            adapter_id,
            adapter_program,
            max_allocation_abs,
        )
    }

    /// Remove/disable an adapter (only when fully deallocated).
    pub fn remove_adapter(ctx: Context<RemoveAdapter>, adapter_id: u64) -> Result<()> {
        instructions::adapter_admin::remove_adapter(ctx, adapter_id)
    }

    /// Set curator and allocator roles.
    pub fn set_roles(ctx: Context<SetRoles>, curator: Pubkey, allocator: Pubkey) -> Result<()> {
        instructions::adapter_admin::set_roles(ctx, curator, allocator)
    }

    /// Choose (or disable) the liquidity adapter.
    /// Pass `0` to disable.
    pub fn set_liquidity_adapter(ctx: Context<SetLiquidityAdapter>, adapter_id: u64) -> Result<()> {
        instructions::adapter_admin::set_liquidity_adapter(ctx, adapter_id)
    }

    /// Set per-adapter absolute cap.
    pub fn set_adapter_caps(
        ctx: Context<SetAdapterCaps>,
        adapter_id: u64,
        max_allocation_abs: u64,
    ) -> Result<()> {
        instructions::adapter_admin::set_adapter_caps(ctx, adapter_id, max_allocation_abs)
    }

    /// Enable an adapter.
    pub fn enable_adapter(ctx: Context<EnableAdapter>, adapter_id: u64) -> Result<()> {
        instructions::adapter_admin::enable_adapter(ctx, adapter_id)
    }

    /// Disable an adapter.
    pub fn disable_adapter(ctx: Context<DisableAdapter>, adapter_id: u64) -> Result<()> {
        instructions::adapter_admin::disable_adapter(ctx, adapter_id)
    }

    // ============ Allocator ============

    /// Allocate idle capital to an adapter position.
    pub fn allocate(
        ctx: Context<Allocate>,
        adapter_id: u64,
        amount: u64,
        data: Vec<u8>,
    ) -> Result<()> {
        instructions::allocator::allocate(ctx, adapter_id, amount, data)
    }

    /// Deallocate capital from an adapter position back into the vault.
    pub fn deallocate(
        ctx: Context<Deallocate>,
        adapter_id: u64,
        amount: u64,
        data: Vec<u8>,
    ) -> Result<()> {
        instructions::allocator::deallocate(ctx, adapter_id, amount, data)
    }

    // ============ Module Admin (feature: modules) ============

    #[cfg(feature = "modules")]
    pub fn initialize_fee_config(
        ctx: Context<InitializeFeeConfig>,
        entry_fee_bps: u16,
        exit_fee_bps: u16,
        management_fee_bps: u16,
        performance_fee_bps: u16,
    ) -> Result<()> {
        instructions::module_admin::initialize_fee_config(
            ctx,
            entry_fee_bps,
            exit_fee_bps,
            management_fee_bps,
            performance_fee_bps,
        )
    }

    #[cfg(feature = "modules")]
    pub fn update_fee_config(
        ctx: Context<UpdateFeeConfig>,
        entry_fee_bps: Option<u16>,
        exit_fee_bps: Option<u16>,
        management_fee_bps: Option<u16>,
        performance_fee_bps: Option<u16>,
    ) -> Result<()> {
        instructions::module_admin::update_fee_config(
            ctx,
            entry_fee_bps,
            exit_fee_bps,
            management_fee_bps,
            performance_fee_bps,
        )
    }

    #[cfg(feature = "modules")]
    pub fn initialize_cap_config(
        ctx: Context<InitializeCapConfig>,
        global_cap: u64,
        per_user_cap: u64,
    ) -> Result<()> {
        instructions::module_admin::initialize_cap_config(ctx, global_cap, per_user_cap)
    }

    #[cfg(feature = "modules")]
    pub fn update_cap_config(
        ctx: Context<UpdateCapConfig>,
        global_cap: Option<u64>,
        per_user_cap: Option<u64>,
    ) -> Result<()> {
        instructions::module_admin::update_cap_config(ctx, global_cap, per_user_cap)
    }

    #[cfg(feature = "modules")]
    pub fn initialize_lock_config(
        ctx: Context<InitializeLockConfig>,
        lock_duration: i64,
    ) -> Result<()> {
        instructions::module_admin::initialize_lock_config(ctx, lock_duration)
    }

    #[cfg(feature = "modules")]
    pub fn update_lock_config(ctx: Context<UpdateLockConfig>, lock_duration: i64) -> Result<()> {
        instructions::module_admin::update_lock_config(ctx, lock_duration)
    }

    #[cfg(feature = "modules")]
    pub fn initialize_access_config(
        ctx: Context<InitializeAccessConfig>,
        mode: state::AccessMode,
        merkle_root: [u8; 32],
    ) -> Result<()> {
        instructions::module_admin::initialize_access_config(ctx, mode, merkle_root)
    }

    #[cfg(feature = "modules")]
    pub fn update_access_config(
        ctx: Context<UpdateAccessConfig>,
        mode: Option<state::AccessMode>,
        merkle_root: Option<[u8; 32]>,
    ) -> Result<()> {
        instructions::module_admin::update_access_config(ctx, mode, merkle_root)
    }

    // ============ View Functions (CPI composable) ============

    /// Preview shares for deposit (floor rounding)
    pub fn preview_deposit(ctx: Context<VaultView>, assets: u64) -> Result<()> {
        instructions::view::preview_deposit(ctx, assets)
    }

    /// Preview assets required for mint (ceiling rounding)
    pub fn preview_mint(ctx: Context<VaultView>, shares: u64) -> Result<()> {
        instructions::view::preview_mint(ctx, shares)
    }

    /// Preview shares to burn for withdraw (ceiling rounding)
    pub fn preview_withdraw(ctx: Context<VaultView>, assets: u64) -> Result<()> {
        instructions::view::preview_withdraw(ctx, assets)
    }

    /// Preview assets for redeem (floor rounding)
    pub fn preview_redeem(ctx: Context<VaultView>, shares: u64) -> Result<()> {
        instructions::view::preview_redeem(ctx, shares)
    }

    /// Convert assets to shares (floor rounding)
    pub fn convert_to_shares(ctx: Context<VaultView>, assets: u64) -> Result<()> {
        instructions::view::convert_to_shares_view(ctx, assets)
    }

    /// Convert shares to assets (floor rounding)
    pub fn convert_to_assets(ctx: Context<VaultView>, shares: u64) -> Result<()> {
        instructions::view::convert_to_assets_view(ctx, shares)
    }

    /// Get total assets in vault
    pub fn total_assets(ctx: Context<VaultView>) -> Result<()> {
        instructions::view::get_total_assets(ctx)
    }

    /// Max assets depositable (u64::MAX or 0 if paused)
    pub fn max_deposit(ctx: Context<VaultView>) -> Result<()> {
        instructions::view::max_deposit(ctx)
    }

    /// Max shares mintable (u64::MAX or 0 if paused)
    pub fn max_mint(ctx: Context<VaultView>) -> Result<()> {
        instructions::view::max_mint(ctx)
    }

    /// Max assets owner can withdraw
    pub fn max_withdraw(ctx: Context<VaultViewWithOwner>) -> Result<()> {
        instructions::view::max_withdraw(ctx)
    }

    /// Max shares owner can redeem
    pub fn max_redeem(ctx: Context<VaultViewWithOwner>) -> Result<()> {
        instructions::view::max_redeem(ctx)
    }
}
