use anchor_lang::prelude::*;

declare_id!("E81TszYGg3oEgaQ4QGrW1cN843rQXGmqPMZbyNM2SrJK");

const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol_config";
const APPROVAL_SEED: &[u8] = b"approval";
const RAW_INSTRUCTION_FINGERPRINT_V1: u8 = 1;
// Backends compute `issued_at` off-chain. To avoid rejecting approvals during minor
// time drift between backend and on-chain validator clocks, allow a small positive skew.
const MAX_ISSUED_AT_FUTURE_SKEW_SECS: i64 = 30;

#[program]
pub mod trustline_validation_engine {
    use super::*;

    pub fn initialize_global_config(
        ctx: Context<InitializeGlobalConfig>,
        publisher_authority: Pubkey,
        auditor_authority: Pubkey,
        domain_separator: [u8; 32],
        default_auto_validity_secs: u64,
        default_manual_validity_secs: u64,
    ) -> Result<()> {
        let global = &mut ctx.accounts.global_config;
        global.admin = ctx.accounts.admin.key();
        global.publisher_authority = publisher_authority;
        global.auditor_authority = auditor_authority;
        global.domain_separator = domain_separator;
        global.default_auto_validity_secs = default_auto_validity_secs;
        global.default_manual_validity_secs = default_manual_validity_secs;
        global.trustline_enabled = true;
        global.sanctions_enabled = false; // TODO: replace with a richer sanctions source for production.
        global.bump = ctx.bumps.global_config;
        global._reserved = [0u8; 29];
        Ok(())
    }

    pub fn update_global_config(
        ctx: Context<UpdateGlobalConfig>,
        publisher_authority: Pubkey,
        auditor_authority: Pubkey,
        trustline_enabled: bool,
        sanctions_enabled: bool,
        default_auto_validity_secs: u64,
        default_manual_validity_secs: u64,
    ) -> Result<()> {
        let global = &mut ctx.accounts.global_config;
        global.publisher_authority = publisher_authority;
        global.auditor_authority = auditor_authority;
        global.trustline_enabled = trustline_enabled;
        global.sanctions_enabled = sanctions_enabled;
        global.default_auto_validity_secs = default_auto_validity_secs;
        global.default_manual_validity_secs = default_manual_validity_secs;
        Ok(())
    }

    pub fn initialize_protocol_config(
        ctx: Context<InitializeProtocolConfig>,
        fingerprint_version: u8,
    ) -> Result<()> {
        require!(
            ctx.accounts.protected_program.executable,
            TrustlineError::InvalidProtectedProgram
        );
        require!(
            fingerprint_version == RAW_INSTRUCTION_FINGERPRINT_V1,
            TrustlineError::UnsupportedFingerprintVersion
        );
        let protocol = &mut ctx.accounts.protocol_config;
        protocol.protected_program = ctx.accounts.protected_program.key();
        protocol.validation_enabled = true;
        protocol.fingerprint_version = fingerprint_version;
        protocol.bump = ctx.bumps.protocol_config;
        protocol._reserved = [0u8; 29];
        Ok(())
    }

    pub fn update_protocol_config(
        ctx: Context<UpdateProtocolConfig>,
        validation_enabled: bool,
        fingerprint_version: u8,
    ) -> Result<()> {
        require!(
            fingerprint_version == RAW_INSTRUCTION_FINGERPRINT_V1,
            TrustlineError::UnsupportedFingerprintVersion
        );
        let protocol = &mut ctx.accounts.protocol_config;
        protocol.validation_enabled = validation_enabled;
        protocol.fingerprint_version = fingerprint_version;
        Ok(())
    }

    pub fn publish_approval(
        ctx: Context<PublishApproval>,
        intent_id: [u8; 32],
        final_tx_id: [u8; 32],
        policy_hash: [u8; 32],
        subject: Pubkey,
        scope: Pubkey,
        instruction_selector: [u8; 8],
        instruction_data_hash: [u8; 32],
        accounts_hash: [u8; 32],
        issued_at: i64,
        approval_required: bool,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            ctx.accounts.global_config.trustline_enabled,
            TrustlineError::TrustlineDisabled
        );
        require!(
            ctx.accounts.protocol_config.validation_enabled,
            TrustlineError::ProtocolValidationDisabled
        );
        require!(
            ctx.accounts.protocol_config.fingerprint_version == RAW_INSTRUCTION_FINGERPRINT_V1,
            TrustlineError::UnsupportedFingerprintVersion
        );

        let max_validity = if approval_required {
            ctx.accounts.global_config.default_manual_validity_secs
        } else {
            ctx.accounts.global_config.default_auto_validity_secs
        };
        let max_validity_i64 =
            i64::try_from(max_validity).map_err(|_| TrustlineError::MathOverflow)?;
        let computed_valid_until = issued_at
            .checked_add(max_validity_i64)
            .ok_or(TrustlineError::MathOverflow)?;
        let max_issued_at = now
            .checked_add(MAX_ISSUED_AT_FUTURE_SKEW_SECS)
            .ok_or(TrustlineError::MathOverflow)?;
        require!(issued_at <= max_issued_at, TrustlineError::IssuedAtInFuture);
        require!(computed_valid_until > now, TrustlineError::ApprovalExpired);
        let oldest_allowed_issued_at = now
            .checked_sub(max_validity_i64)
            .ok_or(TrustlineError::MathOverflow)?;
        require!(
            issued_at >= oldest_allowed_issued_at,
            TrustlineError::ApprovalExpired
        );

        let approval = &mut ctx.accounts.approval;
        approval.protocol_config = ctx.accounts.protocol_config.key();
        approval.intent_id = intent_id;
        approval.final_tx_id = final_tx_id;
        approval.policy_hash = policy_hash;
        approval.subject = subject;
        approval.scope = scope;
        approval.instruction_selector = instruction_selector;
        approval.instruction_data_hash = instruction_data_hash;
        approval.accounts_hash = accounts_hash;
        approval.issued_at = issued_at;
        approval.valid_until = if approval_required {
            0
        } else {
            computed_valid_until
        };
        approval.consumed_at = 0;
        approval.publisher = ctx.accounts.publisher.key();
        approval.status = if approval_required {
            ApprovalStatus::Pending
        } else {
            ApprovalStatus::Approved
        };
        approval.bump = ctx.bumps.approval;
        approval._reserved = [0u8; 29];

        emit!(ApprovalPublished {
            protocol_config: approval.protocol_config,
            final_tx_id,
            intent_id,
            subject,
            scope,
            instruction_selector,
            approval_required,
        });

        Ok(())
    }

    pub fn approve_or_reject_approval(
        ctx: Context<ApproveOrRejectApproval>,
        approved: bool,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let approval = &mut ctx.accounts.approval;

        require!(
            approval.status == ApprovalStatus::Pending,
            TrustlineError::ApprovalNotPending
        );

        if approved {
            approval.status = ApprovalStatus::Approved;
            approval.valid_until = now
                .checked_add(
                    i64::try_from(ctx.accounts.global_config.default_manual_validity_secs)
                        .map_err(|_| TrustlineError::MathOverflow)?,
                )
                .ok_or(TrustlineError::MathOverflow)?;
        } else {
            approval.status = ApprovalStatus::Rejected;
        }

        emit!(ApprovalDecision {
            final_tx_id: approval.final_tx_id,
            approved,
        });

        Ok(())
    }

    pub fn consume_approval(
        ctx: Context<ConsumeApproval>,
        instruction_selector: [u8; 8],
        instruction_data_hash: [u8; 32],
        accounts_hash: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let global = &ctx.accounts.global_config;
        let protocol = &ctx.accounts.protocol_config;
        let approval = &mut ctx.accounts.approval;

        require!(global.trustline_enabled, TrustlineError::TrustlineDisabled);
        require!(
            protocol.validation_enabled,
            TrustlineError::ProtocolValidationDisabled
        );
        require!(
            protocol.fingerprint_version == RAW_INSTRUCTION_FINGERPRINT_V1,
            TrustlineError::UnsupportedFingerprintVersion
        );
        require!(
            ctx.accounts.scope.is_signer,
            TrustlineError::MissingProtectedSigner
        );
        require!(
            ctx.accounts.subject.is_signer,
            TrustlineError::MissingSubjectSignature
        );
        require!(
            ctx.accounts.scope.owner == &protocol.protected_program,
            TrustlineError::InvalidProtectedSigner
        );
        require!(
            approval.protocol_config == protocol.key(),
            TrustlineError::ProtocolConfigMismatch
        );
        require!(
            approval.scope == ctx.accounts.scope.key(),
            TrustlineError::ScopeMismatch
        );
        require!(
            approval.subject == ctx.accounts.subject.key(),
            TrustlineError::SubjectMismatch
        );
        require!(
            approval.instruction_selector == instruction_selector,
            TrustlineError::InstructionSelectorMismatch
        );
        require!(
            approval.instruction_data_hash == instruction_data_hash,
            TrustlineError::InstructionDataHashMismatch
        );
        require!(
            approval.accounts_hash == accounts_hash,
            TrustlineError::AccountsHashMismatch
        );
        require!(
            approval.status == ApprovalStatus::Approved,
            TrustlineError::ApprovalNotApproved
        );
        require!(
            approval.consumed_at == 0,
            TrustlineError::ApprovalAlreadyConsumed
        );
        require!(approval.valid_until >= now, TrustlineError::ApprovalExpired);

        if global.sanctions_enabled {
            // TODO: add on-chain denylist PDAs or oracle integration when the backend flow is ready.
        }

        approval.status = ApprovalStatus::Consumed;
        approval.consumed_at = now;

        emit!(ApprovalConsumed {
            final_tx_id: approval.final_tx_id,
            protocol_config: approval.protocol_config,
            scope: approval.scope,
            subject: approval.subject,
            instruction_selector,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeGlobalConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = GlobalConfig::LEN,
        seeds = [GLOBAL_CONFIG_SEED],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateGlobalConfig<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [GLOBAL_CONFIG_SEED],
        bump = global_config.bump,
        constraint = global_config.admin == admin.key() @ TrustlineError::Unauthorized
    )]
    pub global_config: Account<'info, GlobalConfig>,
}

#[derive(Accounts)]
pub struct InitializeProtocolConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump = global_config.bump,
        constraint = global_config.admin == admin.key() @ TrustlineError::Unauthorized
    )]
    pub global_config: Account<'info, GlobalConfig>,
    /// CHECK: Stored as the program namespace for protected CPIs.
    pub protected_program: AccountInfo<'info>,
    #[account(
        init,
        payer = admin,
        space = ProtocolConfig::LEN,
        seeds = [PROTOCOL_CONFIG_SEED, protected_program.key().as_ref()],
        bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProtocolConfig<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump = global_config.bump,
        constraint = global_config.admin == admin.key() @ TrustlineError::Unauthorized
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED, protocol_config.protected_program.as_ref()],
        bump = protocol_config.bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

#[derive(Accounts)]
#[instruction(_intent_id: [u8; 32], final_tx_id: [u8; 32])]
pub struct PublishApproval<'info> {
    #[account(mut)]
    pub publisher: Signer<'info>,
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump = global_config.bump,
        constraint = global_config.publisher_authority == publisher.key() @ TrustlineError::Unauthorized
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED, protocol_config.protected_program.as_ref()],
        bump = protocol_config.bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = publisher,
        space = Approval::LEN,
        seeds = [APPROVAL_SEED, protocol_config.key().as_ref(), &final_tx_id],
        bump
    )]
    pub approval: Account<'info, Approval>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveOrRejectApproval<'info> {
    pub auditor: Signer<'info>,
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump = global_config.bump,
        constraint = global_config.auditor_authority == auditor.key() @ TrustlineError::Unauthorized
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [APPROVAL_SEED, approval.protocol_config.as_ref(), &approval.final_tx_id],
        bump = approval.bump
    )]
    pub approval: Account<'info, Approval>,
}

#[derive(Accounts)]
pub struct ConsumeApproval<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump = global_config.bump
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        seeds = [PROTOCOL_CONFIG_SEED, protocol_config.protected_program.as_ref()],
        bump = protocol_config.bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        seeds = [APPROVAL_SEED, protocol_config.key().as_ref(), &approval.final_tx_id],
        bump = approval.bump
    )]
    pub approval: Account<'info, Approval>,
    /// CHECK: Must be a signer PDA owned by the protected program.
    pub scope: AccountInfo<'info>,
    /// CHECK: Must be the transaction subject signer (user/admin).
    pub subject: AccountInfo<'info>,
}

#[account]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub publisher_authority: Pubkey,
    pub auditor_authority: Pubkey,
    pub domain_separator: [u8; 32],
    pub default_auto_validity_secs: u64,
    pub default_manual_validity_secs: u64,
    pub trustline_enabled: bool,
    pub sanctions_enabled: bool,
    pub bump: u8,
    pub _reserved: [u8; 29],
}

impl GlobalConfig {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 1 + 29;
}

#[account]
pub struct ProtocolConfig {
    pub protected_program: Pubkey,
    pub validation_enabled: bool,
    pub fingerprint_version: u8,
    pub bump: u8,
    pub _reserved: [u8; 29],
}

impl ProtocolConfig {
    pub const LEN: usize = 8 + 32 + 1 + 1 + 1 + 29;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Rejected,
    Consumed,
}

#[account]
pub struct Approval {
    pub protocol_config: Pubkey,
    pub intent_id: [u8; 32],
    pub final_tx_id: [u8; 32],
    pub policy_hash: [u8; 32],
    pub subject: Pubkey,
    pub scope: Pubkey,
    pub instruction_selector: [u8; 8],
    pub instruction_data_hash: [u8; 32],
    pub accounts_hash: [u8; 32],
    pub issued_at: i64,
    pub valid_until: i64,
    pub consumed_at: i64,
    pub publisher: Pubkey,
    pub status: ApprovalStatus,
    pub bump: u8,
    pub _reserved: [u8; 29],
}

impl Approval {
    pub const LEN: usize =
        8 + 32 + 32 + 32 + 32 + 32 + 32 + 8 + 32 + 32 + 8 + 8 + 8 + 32 + 1 + 1 + 29;
}

#[event]
pub struct ApprovalPublished {
    pub protocol_config: Pubkey,
    pub final_tx_id: [u8; 32],
    pub intent_id: [u8; 32],
    pub subject: Pubkey,
    pub scope: Pubkey,
    pub instruction_selector: [u8; 8],
    pub approval_required: bool,
}

#[event]
pub struct ApprovalDecision {
    pub final_tx_id: [u8; 32],
    pub approved: bool,
}

#[event]
pub struct ApprovalConsumed {
    pub final_tx_id: [u8; 32],
    pub protocol_config: Pubkey,
    pub scope: Pubkey,
    pub subject: Pubkey,
    pub instruction_selector: [u8; 8],
}

#[error_code]
pub enum TrustlineError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Trustline is disabled")]
    TrustlineDisabled,
    #[msg("Protocol validation is disabled")]
    ProtocolValidationDisabled,
    #[msg("Invalid protected program")]
    InvalidProtectedProgram,
    #[msg("Approval expired")]
    ApprovalExpired,
    #[msg("Approval validity exceeds configured maximum")]
    ApprovalValidityTooLong,
    #[msg("Issued timestamp is in the future")]
    IssuedAtInFuture,
    #[msg("Approval is not pending")]
    ApprovalNotPending,
    #[msg("Approval is not approved")]
    ApprovalNotApproved,
    #[msg("Approval was already consumed")]
    ApprovalAlreadyConsumed,
    #[msg("Protected signer is missing")]
    MissingProtectedSigner,
    #[msg("Subject signature is missing")]
    MissingSubjectSignature,
    #[msg("Protected signer is invalid")]
    InvalidProtectedSigner,
    #[msg("Protocol config mismatch")]
    ProtocolConfigMismatch,
    #[msg("Scope mismatch")]
    ScopeMismatch,
    #[msg("Subject mismatch")]
    SubjectMismatch,
    #[msg("Instruction selector mismatch")]
    InstructionSelectorMismatch,
    #[msg("Instruction data hash mismatch")]
    InstructionDataHashMismatch,
    #[msg("Instruction accounts hash mismatch")]
    AccountsHashMismatch,
    #[msg("Unsupported fingerprint version")]
    UnsupportedFingerprintVersion,
    #[msg("Math overflow")]
    MathOverflow,
}
