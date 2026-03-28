//! Admin instructions: pause, unpause, sync_total_assets, transfer authority.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    hash::hash as solana_hash,
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke},
};
use anchor_spl::token_interface::TokenAccount;

use crate::{
    error::VaultError,
    events::{AuthorityTransferred, NavSyncEvent, TrustlineConfigUpdated, VaultStatusChanged},
    state::{AdapterConfig, AdapterPosition, Vault},
    trustline::{
        require_trustline, split_trustline_remaining_accounts, TRUSTLINE_VALIDATION_ENGINE_ID,
    },
};

#[derive(Accounts)]
pub struct Admin<'info> {
    #[account(
        constraint = authority.key() == vault.authority @ VaultError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub vault: Account<'info, Vault>,
}

#[derive(Accounts)]
pub struct SyncTotalAssets<'info> {
    #[account(
        constraint = curator.key() == vault.curator @ VaultError::NotCurator,
    )]
    pub curator: Signer<'info>,

    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(
        constraint = asset_vault.key() == vault.asset_vault,
    )]
    pub asset_vault: InterfaceAccount<'info, TokenAccount>,
}

/// Pause all vault operations (emergency circuit breaker)
pub fn pause<'info>(ctx: Context<'_, '_, '_, 'info, Admin<'info>>) -> Result<()> {
    let (_remaining_accounts, trustline_accounts) = split_trustline_remaining_accounts(
        ctx.remaining_accounts,
        ctx.accounts.vault.trustline_enabled,
    )?;
    let asset_mint_key = ctx.accounts.vault.asset_mint;
    let vault_id_bytes = ctx.accounts.vault.vault_id.to_le_bytes();
    let bump = ctx.accounts.vault.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        crate::constants::VAULT_SEED,
        asset_mint_key.as_ref(),
        vault_id_bytes.as_ref(),
        &[bump],
    ]];
    require_trustline(
        &ctx.accounts.vault.to_account_info(),
        ctx.accounts.vault.trustline_enabled,
        ctx.accounts.vault.validation_engine,
        &ctx.accounts.authority.to_account_info(),
        &trustline_accounts,
        signer_seeds,
    )?;

    let vault = &mut ctx.accounts.vault;

    require!(!vault.paused, VaultError::VaultPaused);

    vault.paused = true;

    emit!(VaultStatusChanged {
        vault: vault.key(),
        paused: true,
    });

    Ok(())
}

/// Unpause vault operations
pub fn unpause<'info>(ctx: Context<'_, '_, '_, 'info, Admin<'info>>) -> Result<()> {
    let (_remaining_accounts, trustline_accounts) = split_trustline_remaining_accounts(
        ctx.remaining_accounts,
        ctx.accounts.vault.trustline_enabled,
    )?;
    let asset_mint_key = ctx.accounts.vault.asset_mint;
    let vault_id_bytes = ctx.accounts.vault.vault_id.to_le_bytes();
    let bump = ctx.accounts.vault.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        crate::constants::VAULT_SEED,
        asset_mint_key.as_ref(),
        vault_id_bytes.as_ref(),
        &[bump],
    ]];
    require_trustline(
        &ctx.accounts.vault.to_account_info(),
        ctx.accounts.vault.trustline_enabled,
        ctx.accounts.vault.validation_engine,
        &ctx.accounts.authority.to_account_info(),
        &trustline_accounts,
        signer_seeds,
    )?;

    let vault = &mut ctx.accounts.vault;

    require!(vault.paused, VaultError::VaultNotPaused);

    vault.paused = false;

    emit!(VaultStatusChanged {
        vault: vault.key(),
        paused: false,
    });

    Ok(())
}

/// Transfer vault authority to new address
pub fn transfer_authority<'info>(
    ctx: Context<'_, '_, '_, 'info, Admin<'info>>,
    new_authority: Pubkey,
) -> Result<()> {
    let (_remaining_accounts, trustline_accounts) = split_trustline_remaining_accounts(
        ctx.remaining_accounts,
        ctx.accounts.vault.trustline_enabled,
    )?;
    let asset_mint_key = ctx.accounts.vault.asset_mint;
    let vault_id_bytes = ctx.accounts.vault.vault_id.to_le_bytes();
    let bump = ctx.accounts.vault.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        crate::constants::VAULT_SEED,
        asset_mint_key.as_ref(),
        vault_id_bytes.as_ref(),
        &[bump],
    ]];
    require_trustline(
        &ctx.accounts.vault.to_account_info(),
        ctx.accounts.vault.trustline_enabled,
        ctx.accounts.vault.validation_engine,
        &ctx.accounts.authority.to_account_info(),
        &trustline_accounts,
        signer_seeds,
    )?;

    let vault = &mut ctx.accounts.vault;
    let previous_authority = vault.authority;

    vault.authority = new_authority;

    emit!(AuthorityTransferred {
        vault: vault.key(),
        previous_authority,
        new_authority,
    });

    Ok(())
}

pub fn set_trustline_config(
    ctx: Context<Admin>,
    _validation_engine: Pubkey,
    enabled: bool,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.validation_engine = TRUSTLINE_VALIDATION_ENGINE_ID;
    vault.trustline_enabled = enabled;

    emit!(TrustlineConfigUpdated {
        vault: vault.key(),
        validation_engine: TRUSTLINE_VALIDATION_ENGINE_ID,
        enabled,
    });

    Ok(())
}

/// Sync total_assets (NAV).
///
/// SVS-13 Phase 3: NAV = idle_assets + Σ real_assets(adapter_i) via CPI return data.
/// Adapter `real_assets()` returns an 8-byte little-endian `u64` in return data.
pub fn sync_total_assets(ctx: Context<SyncTotalAssets>, adapter_ids: Vec<u64>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let idle_assets = ctx.accounts.asset_vault.amount;

    // Enforce compute budget: sync only existing adapters.
    require!(
        adapter_ids.len() <= vault.num_adapters as usize,
        VaultError::MaxAdaptersExceeded
    );

    // Option A: remaining accounts per adapter_id:
    // [(adapter_config), (adapter_position), (adapter_holding), (adapter_program)]
    let expected_accounts = adapter_ids
        .len()
        .checked_mul(4)
        .ok_or(VaultError::MathOverflow)?;
    require!(
        ctx.remaining_accounts.len() == expected_accounts,
        VaultError::AdapterConfigNotFound
    );

    // Pre-compute Anchor-style instruction discriminator for `real_assets()`:
    // sha256("global:real_assets")[..8]
    let real_assets_discriminator = {
        let hash = solana_hash(b"global:real_assets");
        let bytes = hash.to_bytes();
        let mut out = [0u8; 8];
        out.copy_from_slice(&bytes[..8]);
        out
    };
    let real_assets_ix_data = real_assets_discriminator.to_vec();

    let current_slot = Clock::get()?.slot;
    let mut total_assets: u128 = idle_assets as u128;

    for (i, adapter_id) in adapter_ids.iter().enumerate() {
        let cfg_info = &ctx.remaining_accounts[i * 4];
        let pos_info = &ctx.remaining_accounts[i * 4 + 1];
        let holding_info = &ctx.remaining_accounts[i * 4 + 2];
        let program_info = &ctx.remaining_accounts[i * 4 + 3];

        // Deserialize without relying on anchor account type since remaining_accounts are untyped.
        let cfg_data = cfg_info.try_borrow_data()?;
        require!(cfg_data.len() >= 8 + 1, VaultError::AdapterConfigNotFound);
        let cfg: AdapterConfig = AnchorDeserialize::deserialize(&mut &cfg_data[8..])?;

        require!(cfg.vault == vault.key(), VaultError::AdapterConfigNotFound);
        require!(
            cfg.adapter_id == *adapter_id,
            VaultError::AdapterConfigNotFound
        );
        require!(
            cfg.holding_account == *holding_info.key,
            VaultError::AdapterHoldingMismatch
        );
        require!(
            cfg.adapter_program == *program_info.key,
            VaultError::AdapterConfigNotFound
        );
        require!(program_info.executable, VaultError::AdapterConfigNotFound);
        drop(cfg_data);

        // Validate `adapter_position.adapter_id` using byte offsets (avoid full deserialize).
        let pos_data = pos_info.try_borrow_data()?;
        require!(
            pos_data.len() >= 8 + 32 + 8,
            VaultError::AdapterPositionNotFound
        );
        let mut adapter_id_bytes = [0u8; 8];
        adapter_id_bytes.copy_from_slice(&pos_data[8 + 32..8 + 32 + 8]);
        let pos_adapter_id = u64::from_le_bytes(adapter_id_bytes);
        require!(
            pos_adapter_id == *adapter_id,
            VaultError::AdapterPositionNotFound
        );
        // Also ensure adapter_position.vault == vault (first 32 bytes after discriminator).
        let pos_vault_bytes = &pos_data[8..40];
        require!(
            pos_vault_bytes == vault.key().as_ref(),
            VaultError::AdapterPositionNotFound
        );

        drop(pos_data); // allow later mutable borrow

        if !cfg.enabled {
            continue;
        }

        // CPI into adapter program to get current value (u64) via return data.
        //
        // Accounts passed to the adapter (trusted ABI; MVP):
        // - adapter_config (read-only)
        // - adapter_position (read-only; adapter can use it to locate its internal state)
        // - adapter_holding (read-only; vault transferred tokens into it)
        let cfg_meta = if cfg_info.is_writable {
            AccountMeta::new(*cfg_info.key, cfg_info.is_signer)
        } else {
            AccountMeta::new_readonly(*cfg_info.key, cfg_info.is_signer)
        };
        let pos_meta = if pos_info.is_writable {
            AccountMeta::new(*pos_info.key, pos_info.is_signer)
        } else {
            AccountMeta::new_readonly(*pos_info.key, pos_info.is_signer)
        };
        let holding_meta = if holding_info.is_writable {
            AccountMeta::new(*holding_info.key, holding_info.is_signer)
        } else {
            AccountMeta::new_readonly(*holding_info.key, holding_info.is_signer)
        };

        let ix = Instruction {
            program_id: cfg.adapter_program,
            accounts: vec![cfg_meta, pos_meta, holding_meta],
            data: real_assets_ix_data.clone(),
        };

        let cpi_accounts = [
            cfg_info.clone(),
            pos_info.clone(),
            holding_info.clone(),
            program_info.clone(),
        ];
        invoke(&ix, &cpi_accounts).map_err(|_| VaultError::AdapterCpiFailed)?;

        let (_returned_program, data) =
            get_return_data().ok_or(VaultError::AdapterReturnDataMissing)?;
        require!(
            _returned_program == cfg.adapter_program,
            VaultError::AdapterReturnDataWrongProgram
        );
        require!(data.len() >= 8, VaultError::AdapterReturnDataInvalidLength);

        let mut real_assets_bytes = [0u8; 8];
        real_assets_bytes.copy_from_slice(&data[..8]);
        let real_assets = u64::from_le_bytes(real_assets_bytes);

        total_assets = total_assets
            .checked_add(real_assets as u128)
            .ok_or(VaultError::MathOverflow)?;

        // Update AdapterPosition.last_reported_assets and last_reported_slot.
        // Layout: 8 discriminator
        // [0..32] vault
        // [32..40] adapter_id
        // [40..48] principal_deployed
        // [48..56] last_reported_assets
        // [56..64] last_reported_slot
        let mut pos_data_mut = pos_info.try_borrow_mut_data()?;
        require!(
            pos_data_mut.len() >= 8 + 32 + 8 + 8 + 8 + 8,
            VaultError::AdapterPositionNotFound
        );
        pos_data_mut[56..64].copy_from_slice(&real_assets.to_le_bytes());
        pos_data_mut[64..72].copy_from_slice(&current_slot.to_le_bytes());
    }

    let new_total_u64: u64 = total_assets
        .try_into()
        .map_err(|_| VaultError::MathOverflow)?;
    vault.total_assets = new_total_u64;
    vault.last_sync_slot = current_slot;

    emit!(NavSyncEvent {
        vault: vault.key(),
        total_assets: vault.total_assets,
        idle_assets,
    });

    Ok(())
}
