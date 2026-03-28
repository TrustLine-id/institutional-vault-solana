//! Adapter registry admin instructions.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::constants::{ADAPTER_CONFIG_SEED, ADAPTER_POSITION_SEED};
use crate::error::VaultError;
use crate::events::{
    AdapterAdded, AdapterCapUpdated, AdapterEnabled, AdapterRemoved, LiquidityAdapterUpdated,
    RolesUpdated,
};
use crate::state::{AdapterConfig, AdapterPosition, Vault};

// Note: we currently keep enable/disable logic simple: adapter accounts remain
// on-chain and only toggle `enabled`.

#[derive(Accounts)]
#[instruction(adapter_id: u64)]
pub struct AddAdapter<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(mut, constraint = authority.key() == vault.authority @ VaultError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = AdapterConfig::LEN,
        seeds = [ADAPTER_CONFIG_SEED, vault.key().as_ref(), &adapter_id.to_le_bytes()],
        bump
    )]
    pub adapter_config: Account<'info, AdapterConfig>,

    #[account(
        init,
        payer = authority,
        space = AdapterPosition::LEN,
        seeds = [ADAPTER_POSITION_SEED, vault.key().as_ref(), &adapter_id.to_le_bytes()],
        bump
    )]
    pub adapter_position: Account<'info, AdapterPosition>,

    #[account(
        constraint = adapter_holding.mint == vault.asset_mint @ VaultError::AdapterHoldingMismatch,
        constraint = adapter_holding.owner == vault.key() @ VaultError::AdapterHoldingMismatch,
    )]
    pub adapter_holding: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

pub fn add_adapter(
    ctx: Context<AddAdapter>,
    adapter_id: u64,
    adapter_program: Pubkey,
    max_allocation_abs: u64,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    require!(
        vault.num_adapters < vault.max_adapters,
        VaultError::MaxAdaptersExceeded
    );
    require!(adapter_id != 0, VaultError::InvalidAdapterId);

    let adapter_config = &mut ctx.accounts.adapter_config;
    adapter_config.vault = vault.key();
    adapter_config.adapter_id = adapter_id;
    adapter_config.adapter_program = adapter_program;
    adapter_config.enabled = true;
    adapter_config.max_allocation_abs = max_allocation_abs;
    adapter_config.holding_account = ctx.accounts.adapter_holding.key();
    adapter_config.name = [0u8; 32];
    adapter_config.bump = ctx.bumps.adapter_config;
    adapter_config._reserved = [0u8; 32];

    let adapter_position = &mut ctx.accounts.adapter_position;
    adapter_position.vault = vault.key();
    adapter_position.adapter_id = adapter_id;
    adapter_position.principal_deployed = 0;
    adapter_position.last_reported_assets = 0;
    adapter_position.last_reported_slot = 0;
    adapter_position.bump = ctx.bumps.adapter_position;
    adapter_position._reserved = [0u8; 32];

    vault.num_adapters = vault
        .num_adapters
        .checked_add(1)
        .ok_or(VaultError::MathOverflow)?;

    emit!(AdapterAdded {
        vault: vault.key(),
        adapter_id,
        adapter_program,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(adapter_id: u64)]
pub struct RemoveAdapter<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(constraint = authority.key() == vault.authority @ VaultError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [ADAPTER_CONFIG_SEED, vault.key().as_ref(), &adapter_id.to_le_bytes()],
        bump = adapter_config.bump,
        has_one = vault
    )]
    pub adapter_config: Account<'info, AdapterConfig>,

    #[account(
        mut,
        seeds = [ADAPTER_POSITION_SEED, vault.key().as_ref(), &adapter_id.to_le_bytes()],
        bump = adapter_position.bump,
        has_one = vault
    )]
    pub adapter_position: Account<'info, AdapterPosition>,
}

pub fn remove_adapter(ctx: Context<RemoveAdapter>, adapter_id: u64) -> Result<()> {
    let adapter_position = &ctx.accounts.adapter_position;
    require!(
        adapter_position.principal_deployed == 0,
        VaultError::AdapterHasPosition
    );

    let adapter_config = &mut ctx.accounts.adapter_config;
    adapter_config.enabled = false;

    emit!(AdapterRemoved {
        vault: ctx.accounts.vault.key(),
        adapter_id,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct SetRoles<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(constraint = authority.key() == vault.authority @ VaultError::Unauthorized)]
    pub authority: Signer<'info>,
}

pub fn set_roles(ctx: Context<SetRoles>, curator: Pubkey, allocator: Pubkey) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.curator = curator;
    vault.allocator = allocator;

    emit!(RolesUpdated {
        vault: vault.key(),
        curator,
        allocator,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct SetLiquidityAdapter<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(constraint = curator.key() == vault.curator @ VaultError::NotCurator)]
    pub curator: Signer<'info>,
}

pub fn set_liquidity_adapter(ctx: Context<SetLiquidityAdapter>, adapter_id: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let new_id = if adapter_id == 0 {
        None
    } else {
        Some(adapter_id)
    };
    vault.liquidity_adapter_id = new_id;

    emit!(LiquidityAdapterUpdated {
        vault: vault.key(),
        liquidity_adapter_id: adapter_id,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(adapter_id: u64)]
pub struct SetAdapterCaps<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(constraint = curator.key() == vault.curator @ VaultError::NotCurator)]
    pub curator: Signer<'info>,

    #[account(
        mut,
        seeds = [ADAPTER_CONFIG_SEED, vault.key().as_ref(), &adapter_id.to_le_bytes()],
        bump = adapter_config.bump,
        has_one = vault
    )]
    pub adapter_config: Account<'info, AdapterConfig>,
}

pub fn set_adapter_caps(
    ctx: Context<SetAdapterCaps>,
    adapter_id: u64,
    max_allocation_abs: u64,
) -> Result<()> {
    require!(
        ctx.accounts.adapter_config.adapter_id == adapter_id,
        VaultError::AdapterConfigNotFound
    );

    ctx.accounts.adapter_config.max_allocation_abs = max_allocation_abs;

    emit!(AdapterCapUpdated {
        vault: ctx.accounts.vault.key(),
        adapter_id,
        max_allocation_abs,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(adapter_id: u64)]
pub struct EnableAdapter<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(constraint = curator.key() == vault.curator @ VaultError::NotCurator)]
    pub curator: Signer<'info>,

    #[account(
        mut,
        seeds = [ADAPTER_CONFIG_SEED, vault.key().as_ref(), &adapter_id.to_le_bytes()],
        bump = adapter_config.bump,
        has_one = vault
    )]
    pub adapter_config: Account<'info, AdapterConfig>,
}

pub fn enable_adapter(ctx: Context<EnableAdapter>, adapter_id: u64) -> Result<()> {
    require!(
        ctx.accounts.adapter_config.adapter_id == adapter_id,
        VaultError::AdapterConfigNotFound
    );

    ctx.accounts.adapter_config.enabled = true;

    emit!(AdapterEnabled {
        vault: ctx.accounts.vault.key(),
        adapter_id,
        enabled: true,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(adapter_id: u64)]
pub struct DisableAdapter<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(constraint = curator.key() == vault.curator @ VaultError::NotCurator)]
    pub curator: Signer<'info>,

    #[account(
        mut,
        seeds = [ADAPTER_CONFIG_SEED, vault.key().as_ref(), &adapter_id.to_le_bytes()],
        bump = adapter_config.bump,
        has_one = vault
    )]
    pub adapter_config: Account<'info, AdapterConfig>,
}

pub fn disable_adapter(ctx: Context<DisableAdapter>, adapter_id: u64) -> Result<()> {
    require!(
        ctx.accounts.adapter_config.adapter_id == adapter_id,
        VaultError::AdapterConfigNotFound
    );

    ctx.accounts.adapter_config.enabled = false;

    emit!(AdapterEnabled {
        vault: ctx.accounts.vault.key(),
        adapter_id,
        enabled: false,
    });

    Ok(())
}
