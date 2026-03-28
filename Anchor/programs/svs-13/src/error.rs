//! Vault error codes.

use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,

    #[msg("Vault is paused")]
    VaultPaused,

    #[msg("Asset decimals must be <= 9")]
    InvalidAssetDecimals,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    #[msg("Division by zero")]
    DivisionByZero,

    #[msg("Insufficient shares balance")]
    InsufficientShares,

    #[msg("Insufficient assets in vault")]
    InsufficientAssets,

    #[msg("Unauthorized - caller is not vault authority")]
    Unauthorized,

    #[msg("Deposit amount below minimum threshold")]
    DepositTooSmall,

    #[msg("Vault is not paused")]
    VaultNotPaused,

    // Module errors (available with "modules" feature)
    #[msg("Deposit would exceed global vault cap")]
    GlobalCapExceeded,

    #[msg("Entry fee exceeds maximum")]
    EntryFeeExceedsMax,

    #[msg("Lock duration exceeds maximum")]
    LockDurationExceedsMax,

    // =========================
    // SVS-13 Adapter errors
    // =========================
    #[msg("Unauthorized - caller is not curator")]
    NotCurator,

    #[msg("Unauthorized - caller is not allocator")]
    NotAllocator,

    #[msg("Adapter not enabled")]
    AdapterDisabled,

    #[msg("Adapter config not found")]
    AdapterConfigNotFound,

    #[msg("Adapter position not found")]
    AdapterPositionNotFound,

    #[msg("Adapter cap exceeded")]
    AdapterCapExceeded,

    #[msg("Liquidity adapter mismatch")]
    LiquidityAdapterMismatch,

    #[msg("Adapter holding account mismatch")]
    AdapterHoldingMismatch,

    #[msg("Adapter has deployed principal; cannot remove")]
    AdapterHasPosition,

    #[msg("Maximum number of adapters exceeded")]
    MaxAdaptersExceeded,

    #[msg("Invalid adapter id")]
    InvalidAdapterId,

    #[msg("Invalid shares token account")]
    InvalidSharesAccount,

    #[msg("Adapter CPI failed")]
    AdapterCpiFailed,

    #[msg("Missing adapter return data")]
    AdapterReturnDataMissing,

    #[msg("Adapter return data length is invalid")]
    AdapterReturnDataInvalidLength,

    #[msg("Adapter returned data for the wrong program")]
    AdapterReturnDataWrongProgram,

    #[msg("Adapter deallocate return amount mismatch")]
    AdapterDeallocateReturnMismatch,

    #[msg("Trustline account mismatch")]
    TrustlineAccountMismatch,

    #[msg("Trustline configuration missing")]
    TrustlineConfigMissing,

    #[msg("Trustline engine id mismatch")]
    TrustlineEngineMismatch,

    #[msg("Trustline instruction fingerprint mismatch")]
    TrustlineInstructionMismatch,

    #[msg("Trustline validation failed")]
    TrustlineValidationFailed,
}
