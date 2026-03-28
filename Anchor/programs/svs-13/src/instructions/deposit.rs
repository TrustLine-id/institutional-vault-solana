//! Deposit instruction: transfer assets to vault, mint shares to user (stored balance model).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::solana_program::{
    hash::hash as solana_hash,
    instruction::{AccountMeta, Instruction},
    program::invoke,
};
use anchor_spl::{
    associated_token::{self, AssociatedToken},
    token_2022::{self, MintTo, Token2022},
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use spl_token_2022::state::Account as SplTokenAccount;

use crate::{
    constants::{MIN_DEPOSIT_AMOUNT, VAULT_SEED},
    error::VaultError,
    events::Deposit as DepositEvent,
    math::{convert_to_shares, Rounding},
    state::{AdapterConfig, Vault},
    trustline::{require_trustline, split_trustline_remaining_accounts},
};

#[cfg(feature = "modules")]
use svs_module_hooks as module_hooks;

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        constraint = !vault.paused @ VaultError::VaultPaused,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        constraint = asset_mint.key() == vault.asset_mint,
    )]
    pub asset_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = user_asset_account.mint == vault.asset_mint,
        constraint = user_asset_account.owner == user.key(),
    )]
    pub user_asset_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = asset_vault.key() == vault.asset_vault,
    )]
    pub asset_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = shares_mint.key() == vault.shares_mint,
    )]
    pub shares_mint: InterfaceAccount<'info, Mint>,

    // Token-2022 shares account (created idempotently by this instruction).
    // We keep it as untyped `AccountInfo` to avoid Anchor stack-heavy `init_if_needed` constraints.
    /// CHECK: We validate the passed account address in the handler (must equal the user's ATA for `shares_mint`).
    /// Anchor types are intentionally avoided here to reduce BPF stack usage.
    #[account(mut)]
    pub user_shares_account: AccountInfo<'info>,

    /// CHECK: Optional; validated/used only when `vault.liquidity_adapter_id` is set (deserialized in handler).
    /// Optional liquidity adapter config (only used when vault.liquidity_adapter_id is set)
    pub liquidity_adapter_config: Option<AccountInfo<'info>>,

    /// CHECK: Optional; validated/updated only when `vault.liquidity_adapter_id` is set (byte-level field update in handler).
    /// Optional liquidity adapter position (only used when vault.liquidity_adapter_id is set)
    #[account(mut)]
    pub liquidity_adapter_position: Option<AccountInfo<'info>>,

    /// CHECK: Optional; validated in handler by unpacking SPL Token-2022 `Account` state (owner/mint checks).
    /// Optional liquidity adapter holding token account (only used when vault.liquidity_adapter_id is set)
    #[account(mut)]
    pub liquidity_adapter_holding: Option<AccountInfo<'info>>,

    /// CHECK: Optional executable adapter program account (only used when vault.liquidity_adapter_id is set).
    pub liquidity_adapter_program: Option<AccountInfo<'info>>,

    pub asset_token_program: Interface<'info, TokenInterface>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, Deposit<'info>>,
    assets: u64,
    min_shares_out: u64,
) -> Result<()> {
    require!(assets > 0, VaultError::ZeroAmount);
    require!(assets >= MIN_DEPOSIT_AMOUNT, VaultError::DepositTooSmall);
    let (_remaining_accounts, trustline_accounts) = split_trustline_remaining_accounts(
        ctx.remaining_accounts,
        ctx.accounts.vault.trustline_enabled,
    )?;

    let asset_mint_key = ctx.accounts.vault.asset_mint;
    let vault_id_bytes = ctx.accounts.vault.vault_id.to_le_bytes();
    let bump = ctx.accounts.vault.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        VAULT_SEED,
        asset_mint_key.as_ref(),
        vault_id_bytes.as_ref(),
        &[bump],
    ]];
    require_trustline(
        &ctx.accounts.vault.to_account_info(),
        ctx.accounts.vault.trustline_enabled,
        ctx.accounts.vault.validation_engine,
        &ctx.accounts.user.to_account_info(),
        &trustline_accounts,
        signer_seeds,
    )?;

    let vault = &ctx.accounts.vault;
    let total_shares = ctx.accounts.shares_mint.supply;
    // SVS-2 baseline: Use STORED balance (vault.total_assets)
    let total_assets = vault.total_assets;

    // ===== Module Hooks (if enabled) =====
    #[cfg(feature = "modules")]
    let net_shares = {
        let remaining = &_remaining_accounts;
        let vault_key = vault.key();
        let user_key = ctx.accounts.user.key();

        // 1. Access control check (whitelist/blacklist + frozen)
        module_hooks::check_deposit_access(remaining, &crate::ID, &vault_key, &user_key, &[])?;

        // 2. Cap enforcement
        module_hooks::check_deposit_caps(
            remaining,
            &crate::ID,
            &vault_key,
            &user_key,
            total_assets,
            assets,
        )?;

        // Calculate shares to mint (floor rounding - favors vault)
        let shares = convert_to_shares(
            assets,
            total_assets,
            total_shares,
            vault.decimals_offset,
            Rounding::Floor,
        )?;

        // 3. Apply entry fee
        let result = module_hooks::apply_entry_fee(remaining, &crate::ID, &vault_key, shares)?;
        result.net_shares
    };

    #[cfg(not(feature = "modules"))]
    let net_shares = {
        // Calculate shares to mint (floor rounding - favors vault)
        convert_to_shares(
            assets,
            total_assets,
            total_shares,
            vault.decimals_offset,
            Rounding::Floor,
        )?
    };

    // Slippage check (on net shares after fee)
    require!(net_shares >= min_shares_out, VaultError::SlippageExceeded);

    // Transfer assets from user either to idle (asset_vault) or directly into the liquidity adapter holding.
    if let Some(liquidity_id) = vault.liquidity_adapter_id {
        let cfg_info = ctx
            .accounts
            .liquidity_adapter_config
            .as_ref()
            .ok_or(VaultError::LiquidityAdapterMismatch)?;
        let pos_info = ctx
            .accounts
            .liquidity_adapter_position
            .as_ref()
            .ok_or(VaultError::LiquidityAdapterMismatch)?;
        let holding = ctx
            .accounts
            .liquidity_adapter_holding
            .as_ref()
            .ok_or(VaultError::LiquidityAdapterMismatch)?;
        let adapter_program = ctx
            .accounts
            .liquidity_adapter_program
            .as_ref()
            .ok_or(VaultError::LiquidityAdapterMismatch)?;

        let cfg_data = cfg_info.try_borrow_data()?;
        let cfg: AdapterConfig = AnchorDeserialize::deserialize(&mut &cfg_data[8..])?;
        require!(
            cfg.adapter_id == liquidity_id,
            VaultError::LiquidityAdapterMismatch
        );
        require!(cfg.enabled, VaultError::AdapterDisabled);
        require!(
            cfg.vault == vault.key(),
            VaultError::LiquidityAdapterMismatch
        );
        require!(
            cfg.holding_account == *holding.key,
            VaultError::AdapterHoldingMismatch
        );
        require!(
            cfg.adapter_program == *adapter_program.key,
            VaultError::LiquidityAdapterMismatch
        );
        require!(
            adapter_program.executable,
            VaultError::LiquidityAdapterMismatch
        );
        drop(cfg_data);

        // Validate adapter holding token account (kept untyped in the account context
        // to reduce Anchor `try_accounts()` stack usage).
        let holding_data = holding.try_borrow_data()?;
        let holding_state = SplTokenAccount::unpack(&holding_data)
            .map_err(|_| VaultError::LiquidityAdapterMismatch)?;
        require!(
            holding_state.owner == vault.key(),
            VaultError::LiquidityAdapterMismatch
        );
        require!(
            holding_state.mint == vault.asset_mint,
            VaultError::LiquidityAdapterMismatch
        );
        drop(holding_data);

        transfer_checked(
            CpiContext::new(
                ctx.accounts.asset_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_asset_account.to_account_info(),
                    to: holding.clone(),
                    mint: ctx.accounts.asset_mint.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            assets,
            ctx.accounts.asset_mint.decimals,
        )?;

        // Treat deposited funds as immediately deployed to the liquidity adapter.
        {
            let mut pos_data = pos_info.try_borrow_mut_data()?;
            // AdapterPosition layout in bytes:
            // 8 discriminator + 32 vault + 8 adapter_id + 8 principal_deployed
            require!(
                pos_data.len() >= 8 + 32 + 8 + 8,
                VaultError::AdapterPositionNotFound
            );

            // Verify PDA fields we care about.
            let pos_vault_bytes = &pos_data[8..40];
            require!(
                pos_vault_bytes == vault.key().as_ref(),
                VaultError::LiquidityAdapterMismatch
            );

            let mut adapter_id_bytes = [0u8; 8];
            adapter_id_bytes.copy_from_slice(&pos_data[40..48]);
            let pos_adapter_id = u64::from_le_bytes(adapter_id_bytes);
            require!(
                pos_adapter_id == liquidity_id,
                VaultError::LiquidityAdapterMismatch
            );

            let mut principal_bytes = [0u8; 8];
            principal_bytes.copy_from_slice(&pos_data[48..56]);
            let principal_deployed = u64::from_le_bytes(principal_bytes);

            let new_principal = principal_deployed
                .checked_add(assets)
                .ok_or(VaultError::MathOverflow)?;
            pos_data[48..56].copy_from_slice(&new_principal.to_le_bytes());
            drop(pos_data);
        }

        // Optional phase-4 behavior: if this vault has a designated liquidity adapter,
        // route funds to its holding account AND immediately CPI `allocate` so the adapter
        // updates internal state (Morpho V2 "liquidity adapter" concept).
        //
        // MVP choice: call allocate(amount, data=[]) for deposits/mints because this handler
        // doesn't receive adapter-specific data.
        let allocate_discriminator = {
            let hash = solana_hash(b"global:allocate");
            let bytes = hash.to_bytes();
            let mut out = [0u8; 8];
            out.copy_from_slice(&bytes[..8]);
            out
        };

        let mut ix_data: Vec<u8> = Vec::with_capacity(8 + 8 + 4);
        ix_data.extend_from_slice(&allocate_discriminator);
        ix_data.extend_from_slice(&assets.to_le_bytes());
        ix_data.extend_from_slice(&0u32.to_le_bytes());

        let ix = Instruction {
            program_id: cfg.adapter_program,
            accounts: vec![
                AccountMeta::new_readonly(cfg_info.key(), false),
                AccountMeta::new_readonly(pos_info.key(), false),
                AccountMeta::new(holding.key(), false),
            ],
            data: ix_data,
        };

        let cpi_accounts = [
            cfg_info.clone(),
            pos_info.clone(),
            holding.clone(),
            adapter_program.clone(),
        ];
        invoke(&ix, &cpi_accounts).map_err(|_| VaultError::AdapterCpiFailed)?;
    } else {
        // Default path: transfer to idle liquidity.
        transfer_checked(
            CpiContext::new(
                ctx.accounts.asset_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_asset_account.to_account_info(),
                    to: ctx.accounts.asset_vault.to_account_info(),
                    mint: ctx.accounts.asset_mint.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            assets,
            ctx.accounts.asset_mint.decimals,
        )?;
    }

    // Ensure the user's shares ATA exists (idempotent create, then mint).
    let expected_user_shares_ata = associated_token::get_associated_token_address_with_program_id(
        &ctx.accounts.user.key(),
        &ctx.accounts.shares_mint.key(),
        &ctx.accounts.token_2022_program.key(),
    );
    require!(
        ctx.accounts.user_shares_account.key() == expected_user_shares_ata,
        VaultError::InvalidSharesAccount
    );
    associated_token::create_idempotent(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        anchor_spl::associated_token::Create {
            payer: ctx.accounts.user.to_account_info(),
            associated_token: ctx.accounts.user_shares_account.clone(),
            authority: ctx.accounts.user.to_account_info(),
            mint: ctx.accounts.shares_mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_2022_program.to_account_info(),
        },
    ))?;

    // Mint shares to user (vault PDA is mint authority)
    let signer_seeds: &[&[&[u8]]] = &[&[
        VAULT_SEED,
        asset_mint_key.as_ref(),
        vault_id_bytes.as_ref(),
        &[bump],
    ]];

    token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.shares_mint.to_account_info(),
                to: ctx.accounts.user_shares_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        net_shares,
    )?;

    // Update cached total assets
    let vault = &mut ctx.accounts.vault;
    vault.total_assets = vault
        .total_assets
        .checked_add(assets)
        .ok_or(VaultError::MathOverflow)?;

    emit!(DepositEvent {
        vault: ctx.accounts.vault.key(),
        caller: ctx.accounts.user.key(),
        owner: ctx.accounts.user.key(),
        assets,
        shares: net_shares,
    });

    Ok(())
}
