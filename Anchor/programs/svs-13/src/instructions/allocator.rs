//! Allocator instructions for moving capital into adapter-controlled positions.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    hash::hash as solana_hash,
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke},
    program_pack::Pack,
};
use anchor_spl::token_interface::{transfer_checked, Mint, TokenInterface, TransferChecked};
use spl_token_2022::state::Account as SplTokenAccount;

use crate::{
    constants::VAULT_SEED,
    error::VaultError,
    events::{AllocateEvent, DeallocateEvent},
    math::{convert_to_assets, Rounding},
    state::{AdapterConfig, AdapterPosition, Vault},
};

use crate::constants::{ADAPTER_CONFIG_SEED, ADAPTER_POSITION_SEED};

#[derive(Accounts)]
#[instruction(adapter_id: u64)]
pub struct Allocate<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(constraint = allocator.key() == vault.allocator @ VaultError::NotAllocator)]
    pub allocator: Signer<'info>,

    #[account(
        seeds = [ADAPTER_CONFIG_SEED, vault.key().as_ref(), &adapter_id.to_le_bytes()],
        bump = adapter_config.bump,
        has_one = vault,
    )]
    pub adapter_config: Account<'info, AdapterConfig>,

    #[account(
        mut,
        seeds = [ADAPTER_POSITION_SEED, vault.key().as_ref(), &adapter_id.to_le_bytes()],
        bump = adapter_position.bump,
        has_one = vault,
    )]
    pub adapter_position: Account<'info, AdapterPosition>,

    #[account(
        mut,
        constraint = asset_vault.key() == vault.asset_vault,
    )]
    /// CHECK: Validated in handler by unpacking SPL Token account state.
    pub asset_vault: AccountInfo<'info>,

    /// Adapter holding token account.
    /// MVP requirement: must be owned/authorized by the vault PDA so SVS-13 can deallocate directly.
    #[account(
        mut,
        constraint = adapter_holding.key() == adapter_config.holding_account @ VaultError::AdapterHoldingMismatch,
    )]
    /// CHECK: Validated in handler by unpacking SPL Token account state.
    pub adapter_holding: AccountInfo<'info>,

    #[account(
        constraint = asset_mint.key() == vault.asset_mint,
    )]
    pub asset_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Executable adapter program account validated in the handler.
    pub adapter_program: AccountInfo<'info>,

    pub asset_token_program: Interface<'info, TokenInterface>,
    pub token_2022_program: Program<'info, anchor_spl::token_2022::Token2022>,
}

pub fn allocate(ctx: Context<Allocate>, adapter_id: u64, amount: u64, data: Vec<u8>) -> Result<()> {
    let vault = &ctx.accounts.vault;
    require!(
        adapter_id == ctx.accounts.adapter_config.adapter_id,
        VaultError::AdapterConfigNotFound
    );
    require!(amount > 0, VaultError::ZeroAmount);
    require!(
        ctx.accounts.adapter_config.enabled,
        VaultError::AdapterDisabled
    );
    require!(
        ctx.accounts.adapter_program.key() == ctx.accounts.adapter_config.adapter_program,
        VaultError::AdapterConfigNotFound
    );
    require!(
        ctx.accounts.adapter_program.executable,
        VaultError::AdapterConfigNotFound
    );

    let asset_vault_data = ctx.accounts.asset_vault.try_borrow_data()?;
    let asset_vault_state =
        SplTokenAccount::unpack(&asset_vault_data).map_err(|_| VaultError::InsufficientAssets)?;
    require!(
        asset_vault_state.mint == vault.asset_mint,
        VaultError::InsufficientAssets
    );
    require!(
        asset_vault_state.owner == vault.key(),
        VaultError::InsufficientAssets
    );
    drop(asset_vault_data);

    let adapter_holding_data = ctx.accounts.adapter_holding.try_borrow_data()?;
    let adapter_holding_state = SplTokenAccount::unpack(&adapter_holding_data)
        .map_err(|_| VaultError::AdapterHoldingMismatch)?;
    require!(
        adapter_holding_state.mint == vault.asset_mint,
        VaultError::AdapterHoldingMismatch
    );
    require!(
        adapter_holding_state.owner == vault.key(),
        VaultError::AdapterHoldingMismatch
    );
    drop(adapter_holding_data);

    // Enforce absolute cap (0 = no cap)
    let cap = ctx.accounts.adapter_config.max_allocation_abs;
    if cap > 0 {
        let new_principal = ctx
            .accounts
            .adapter_position
            .principal_deployed
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?;
        require!(new_principal <= cap, VaultError::AdapterCapExceeded);
    }

    // Transfer capital: vault.asset_vault -> adapter_holding
    let asset_mint_key = vault.asset_mint;
    let vault_id_bytes = vault.vault_id.to_le_bytes();
    let bump = vault.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        VAULT_SEED,
        asset_mint_key.as_ref(),
        vault_id_bytes.as_ref(),
        &[bump],
    ]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.asset_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.asset_vault.to_account_info(),
                to: ctx.accounts.adapter_holding.to_account_info(),
                mint: ctx.accounts.asset_mint.to_account_info(),
                authority: vault.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.asset_mint.decimals,
    )?;

    let pos = &mut ctx.accounts.adapter_position;
    pos.principal_deployed = pos
        .principal_deployed
        .checked_add(amount)
        .ok_or(VaultError::MathOverflow)?;

    // CPI into adapter to let it update its internal position state.
    // Adapter ABI (Anchor-style global instruction):
    // allocate(amount: u64, data: Vec<u8>)
    let allocate_discriminator = {
        let hash = solana_hash(b"global:allocate");
        let bytes = hash.to_bytes();
        let mut out = [0u8; 8];
        out.copy_from_slice(&bytes[..8]);
        out
    };

    let data_len: u32 = data
        .len()
        .try_into()
        .map_err(|_| VaultError::MathOverflow)?;

    let mut ix_data: Vec<u8> = Vec::with_capacity(8 + 8 + 4 + data.len());
    ix_data.extend_from_slice(&allocate_discriminator);
    ix_data.extend_from_slice(&amount.to_le_bytes());
    ix_data.extend_from_slice(&data_len.to_le_bytes());
    ix_data.extend_from_slice(&data);

    let ix = Instruction {
        program_id: ctx.accounts.adapter_config.adapter_program,
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.adapter_config.key(), false),
            AccountMeta::new_readonly(ctx.accounts.adapter_position.key(), false),
            AccountMeta::new(ctx.accounts.adapter_holding.key(), false),
        ],
        data: ix_data,
    };

    let cpi_accounts = [
        ctx.accounts.adapter_config.to_account_info(),
        ctx.accounts.adapter_position.to_account_info(),
        ctx.accounts.adapter_holding.to_account_info(),
        ctx.accounts.adapter_program.to_account_info(),
    ];
    invoke(&ix, &cpi_accounts).map_err(|_| VaultError::AdapterCpiFailed)?;

    emit!(AllocateEvent {
        vault: vault.key(),
        adapter_id,
        amount,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(adapter_id: u64)]
pub struct Deallocate<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(constraint = allocator.key() == vault.allocator @ VaultError::NotAllocator)]
    pub allocator: Signer<'info>,

    #[account(
        seeds = [ADAPTER_CONFIG_SEED, vault.key().as_ref(), &adapter_id.to_le_bytes()],
        bump = adapter_config.bump,
        has_one = vault,
    )]
    pub adapter_config: Account<'info, AdapterConfig>,

    #[account(
        mut,
        seeds = [ADAPTER_POSITION_SEED, vault.key().as_ref(), &adapter_id.to_le_bytes()],
        bump = adapter_position.bump,
        has_one = vault,
    )]
    pub adapter_position: Account<'info, AdapterPosition>,

    #[account(
        mut,
        constraint = asset_vault.key() == vault.asset_vault,
    )]
    /// CHECK: Validated in handler by unpacking SPL Token account state.
    pub asset_vault: AccountInfo<'info>,

    #[account(
        mut,
        constraint = adapter_holding.key() == adapter_config.holding_account @ VaultError::AdapterHoldingMismatch,
    )]
    /// CHECK: Validated in handler by unpacking SPL Token account state.
    pub adapter_holding: AccountInfo<'info>,

    #[account(
        constraint = asset_mint.key() == vault.asset_mint,
    )]
    pub asset_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Executable adapter program account validated in the handler.
    pub adapter_program: AccountInfo<'info>,

    pub asset_token_program: Interface<'info, TokenInterface>,
    pub token_2022_program: Program<'info, anchor_spl::token_2022::Token2022>,
}

pub fn deallocate(
    ctx: Context<Deallocate>,
    adapter_id: u64,
    amount: u64,
    data: Vec<u8>,
) -> Result<()> {
    let vault = &ctx.accounts.vault;
    require!(
        adapter_id == ctx.accounts.adapter_config.adapter_id,
        VaultError::AdapterConfigNotFound
    );
    require!(amount > 0, VaultError::ZeroAmount);
    require!(
        ctx.accounts.adapter_config.enabled,
        VaultError::AdapterDisabled
    );
    require!(
        ctx.accounts.adapter_program.key() == ctx.accounts.adapter_config.adapter_program,
        VaultError::AdapterConfigNotFound
    );
    require!(
        ctx.accounts.adapter_program.executable,
        VaultError::AdapterConfigNotFound
    );

    let asset_vault_data = ctx.accounts.asset_vault.try_borrow_data()?;
    let asset_vault_state =
        SplTokenAccount::unpack(&asset_vault_data).map_err(|_| VaultError::InsufficientAssets)?;
    require!(
        asset_vault_state.mint == vault.asset_mint,
        VaultError::InsufficientAssets
    );
    require!(
        asset_vault_state.owner == vault.key(),
        VaultError::InsufficientAssets
    );
    drop(asset_vault_data);

    let adapter_holding_data = ctx.accounts.adapter_holding.try_borrow_data()?;
    let adapter_holding_state = SplTokenAccount::unpack(&adapter_holding_data)
        .map_err(|_| VaultError::AdapterHoldingMismatch)?;
    require!(
        adapter_holding_state.mint == vault.asset_mint,
        VaultError::AdapterHoldingMismatch
    );
    require!(
        adapter_holding_state.owner == vault.key(),
        VaultError::AdapterHoldingMismatch
    );
    drop(adapter_holding_data);

    let principal_deployed = ctx.accounts.adapter_position.principal_deployed;
    require!(principal_deployed >= amount, VaultError::InsufficientAssets);

    // Transfer capital: adapter_holding -> vault.asset_vault
    let asset_mint_key = vault.asset_mint;
    let vault_id_bytes = vault.vault_id.to_le_bytes();
    let bump = vault.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        VAULT_SEED,
        asset_mint_key.as_ref(),
        vault_id_bytes.as_ref(),
        &[bump],
    ]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.asset_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.adapter_holding.to_account_info(),
                to: ctx.accounts.asset_vault.to_account_info(),
                mint: ctx.accounts.asset_mint.to_account_info(),
                authority: vault.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.asset_mint.decimals,
    )?;

    // CPI into adapter after recall so it can reconcile internal state.
    // Adapter ABI (Anchor-style global instruction):
    // deallocate(amount: u64, data: Vec<u8>) -> Result<u64>
    let deallocate_discriminator = {
        let hash = solana_hash(b"global:deallocate");
        let bytes = hash.to_bytes();
        let mut out = [0u8; 8];
        out.copy_from_slice(&bytes[..8]);
        out
    };

    let data_len: u32 = data
        .len()
        .try_into()
        .map_err(|_| VaultError::MathOverflow)?;

    let mut ix_data: Vec<u8> = Vec::with_capacity(8 + 8 + 4 + data.len());
    ix_data.extend_from_slice(&deallocate_discriminator);
    ix_data.extend_from_slice(&amount.to_le_bytes());
    ix_data.extend_from_slice(&data_len.to_le_bytes());
    ix_data.extend_from_slice(&data);

    let ix = Instruction {
        program_id: ctx.accounts.adapter_config.adapter_program,
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.adapter_config.key(), false),
            AccountMeta::new_readonly(ctx.accounts.adapter_position.key(), false),
            AccountMeta::new(ctx.accounts.adapter_holding.key(), false),
        ],
        data: ix_data,
    };

    let cpi_accounts = [
        ctx.accounts.adapter_config.to_account_info(),
        ctx.accounts.adapter_position.to_account_info(),
        ctx.accounts.adapter_holding.to_account_info(),
        ctx.accounts.adapter_program.to_account_info(),
    ];
    invoke(&ix, &cpi_accounts).map_err(|_| VaultError::AdapterCpiFailed)?;

    // Reconciliation: adapter may return recalled assets as u64 via return-data.
    let (returned_program, return_data) =
        get_return_data().ok_or(VaultError::AdapterReturnDataMissing)?;
    require!(
        returned_program == ctx.accounts.adapter_config.adapter_program,
        VaultError::AdapterReturnDataWrongProgram
    );
    require!(
        return_data.len() >= 8,
        VaultError::AdapterReturnDataInvalidLength
    );

    let mut assets_received_bytes = [0u8; 8];
    assets_received_bytes.copy_from_slice(&return_data[..8]);
    let assets_received = u64::from_le_bytes(assets_received_bytes);
    require!(
        assets_received == amount,
        VaultError::AdapterDeallocateReturnMismatch
    );

    let pos = &mut ctx.accounts.adapter_position;
    pos.principal_deployed = pos
        .principal_deployed
        .checked_sub(assets_received)
        .ok_or(VaultError::MathOverflow)?;

    emit!(DeallocateEvent {
        vault: vault.key(),
        adapter_id,
        amount,
    });

    Ok(())
}
