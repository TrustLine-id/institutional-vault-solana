use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    hash::{hash as solana_hash, hashv},
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    pubkey,
    sysvar::instructions::{
        load_current_index_checked, load_instruction_at_checked, ID as INSTRUCTIONS_SYSVAR_ID,
    },
};

use crate::error::VaultError;

pub const TRUSTLINE_VALIDATION_ENGINE_ID: Pubkey =
    pubkey!("E81TszYGg3oEgaQ4QGrW1cN843rQXGmqPMZbyNM2SrJK");
const TRUSTLINE_GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
const TRUSTLINE_PROTOCOL_CONFIG_SEED: &[u8] = b"protocol_config";
pub const TRUSTLINE_SELECTOR_LEN: usize = 8;
pub const TRUSTLINE_REMAINING_ACCOUNT_COUNT: usize = 5;

#[derive(Clone)]
pub struct TrustlineRemainingAccounts<'info> {
    pub global_config: Option<AccountInfo<'info>>,
    pub protocol_config: Option<AccountInfo<'info>>,
    pub approval: Option<AccountInfo<'info>>,
    pub engine_program: Option<AccountInfo<'info>>,
    pub instructions_sysvar: Option<AccountInfo<'info>>,
}

impl<'info> TrustlineRemainingAccounts<'info> {
    pub fn from_options(
        global_config: Option<AccountInfo<'info>>,
        protocol_config: Option<AccountInfo<'info>>,
        approval: Option<AccountInfo<'info>>,
        engine_program: Option<AccountInfo<'info>>,
        instructions_sysvar: Option<AccountInfo<'info>>,
    ) -> Self {
        Self {
            global_config,
            protocol_config,
            approval,
            engine_program,
            instructions_sysvar,
        }
    }
}

#[derive(Clone, Copy)]
pub struct TrustlineInstructionFingerprint {
    pub instruction_selector: [u8; TRUSTLINE_SELECTOR_LEN],
    pub instruction_data_hash: [u8; 32],
    pub accounts_hash: [u8; 32],
}

fn consume_approval_discriminator() -> [u8; 8] {
    let hash = solana_hash(b"global:consume_approval");
    let bytes = hash.to_bytes();
    let mut out = [0u8; 8];
    out.copy_from_slice(&bytes[..8]);
    out
}

fn instruction_selector(data: &[u8]) -> [u8; TRUSTLINE_SELECTOR_LEN] {
    let mut selector = [0u8; TRUSTLINE_SELECTOR_LEN];
    let selector_len = data.len().min(TRUSTLINE_SELECTOR_LEN);
    selector[..selector_len].copy_from_slice(&data[..selector_len]);
    selector
}

fn instruction_data_hash(data: &[u8]) -> [u8; 32] {
    hashv(&[b"trustline_instruction_data_v1", data]).to_bytes()
}

fn instruction_accounts_hash(accounts: &[AccountMeta]) -> [u8; 32] {
    let mut encoded = Vec::with_capacity(8 + accounts.len() * 34);
    encoded.extend_from_slice(&(accounts.len() as u64).to_le_bytes());
    for account in accounts {
        encoded.extend_from_slice(account.pubkey.as_ref());
        encoded.push(u8::from(account.is_signer));
        encoded.push(u8::from(account.is_writable));
    }
    hashv(&[b"trustline_instruction_accounts_v1", &encoded]).to_bytes()
}

fn current_instruction_fingerprint<'info>(
    scope: &AccountInfo<'info>,
    instructions_sysvar: &AccountInfo<'info>,
) -> Result<TrustlineInstructionFingerprint> {
    require!(
        instructions_sysvar.key == &INSTRUCTIONS_SYSVAR_ID,
        VaultError::TrustlineAccountMismatch
    );

    let current_index = usize::from(load_current_index_checked(instructions_sysvar)?);
    let current_instruction = load_instruction_at_checked(current_index, instructions_sysvar)?;

    require!(
        current_instruction.program_id == *scope.owner,
        VaultError::TrustlineInstructionMismatch
    );
    require!(
        current_instruction.accounts.len() >= TRUSTLINE_REMAINING_ACCOUNT_COUNT,
        VaultError::TrustlineConfigMissing
    );

    let protected_accounts_len =
        current_instruction.accounts.len() - TRUSTLINE_REMAINING_ACCOUNT_COUNT;
    let protected_accounts = &current_instruction.accounts[..protected_accounts_len];

    Ok(TrustlineInstructionFingerprint {
        instruction_selector: instruction_selector(&current_instruction.data),
        instruction_data_hash: instruction_data_hash(&current_instruction.data),
        accounts_hash: instruction_accounts_hash(protected_accounts),
    })
}

fn expected_global_config() -> Pubkey {
    Pubkey::find_program_address(
        &[TRUSTLINE_GLOBAL_CONFIG_SEED],
        &TRUSTLINE_VALIDATION_ENGINE_ID,
    )
    .0
}

fn expected_protocol_config(protected_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[TRUSTLINE_PROTOCOL_CONFIG_SEED, protected_program.as_ref()],
        &TRUSTLINE_VALIDATION_ENGINE_ID,
    )
    .0
}

fn validate_trailing_trustline_accounts(
    scope: &AccountInfo<'_>,
    trustline_accounts: &TrustlineRemainingAccounts<'_>,
) -> Result<()> {
    let instructions_sysvar = trustline_accounts
        .instructions_sysvar
        .as_ref()
        .ok_or(VaultError::TrustlineConfigMissing)?;

    let current_index = usize::from(load_current_index_checked(instructions_sysvar)?);
    let current_instruction = load_instruction_at_checked(current_index, instructions_sysvar)?;

    require!(
        current_instruction.program_id == *scope.owner,
        VaultError::TrustlineInstructionMismatch
    );
    require!(
        current_instruction.accounts.len() >= TRUSTLINE_REMAINING_ACCOUNT_COUNT,
        VaultError::TrustlineConfigMissing
    );

    let trustline_accounts_start =
        current_instruction.accounts.len() - TRUSTLINE_REMAINING_ACCOUNT_COUNT;
    let trailing_accounts = &current_instruction.accounts[trustline_accounts_start..];
    let expected_global = expected_global_config();
    let expected_protocol = expected_protocol_config(scope.owner);

    require!(
        trailing_accounts[0].pubkey
            == *trustline_accounts
                .global_config
                .as_ref()
                .ok_or(VaultError::TrustlineConfigMissing)?
                .key,
        VaultError::TrustlineAccountMismatch
    );
    require!(
        trailing_accounts[0].pubkey == expected_global,
        VaultError::TrustlineAccountMismatch
    );
    require!(
        trailing_accounts[1].pubkey
            == *trustline_accounts
                .protocol_config
                .as_ref()
                .ok_or(VaultError::TrustlineConfigMissing)?
                .key,
        VaultError::TrustlineAccountMismatch
    );
    require!(
        trailing_accounts[1].pubkey == expected_protocol,
        VaultError::TrustlineAccountMismatch
    );
    require!(
        trailing_accounts[2].pubkey
            == *trustline_accounts
                .approval
                .as_ref()
                .ok_or(VaultError::TrustlineConfigMissing)?
                .key,
        VaultError::TrustlineAccountMismatch
    );
    require!(
        trailing_accounts[3].pubkey
            == *trustline_accounts
                .engine_program
                .as_ref()
                .ok_or(VaultError::TrustlineConfigMissing)?
                .key,
        VaultError::TrustlineAccountMismatch
    );
    require!(
        trailing_accounts[3].pubkey == TRUSTLINE_VALIDATION_ENGINE_ID,
        VaultError::TrustlineEngineMismatch
    );
    require!(
        trailing_accounts[4].pubkey == *instructions_sysvar.key,
        VaultError::TrustlineAccountMismatch
    );

    Ok(())
}

pub fn split_trustline_remaining_accounts<'info>(
    remaining: &[AccountInfo<'info>],
    trustline_enabled: bool,
) -> Result<(Vec<AccountInfo<'info>>, TrustlineRemainingAccounts<'info>)> {
    if !trustline_enabled {
        return Ok((
            remaining.to_vec(),
            TrustlineRemainingAccounts::from_options(None, None, None, None, None),
        ));
    }

    require!(
        remaining.len() >= TRUSTLINE_REMAINING_ACCOUNT_COUNT,
        VaultError::TrustlineConfigMissing
    );

    let split_index = remaining.len() - TRUSTLINE_REMAINING_ACCOUNT_COUNT;
    let trustline_accounts = &remaining[split_index..];

    Ok((
        remaining[..split_index].to_vec(),
        TrustlineRemainingAccounts::from_options(
            Some(trustline_accounts[0].clone()),
            Some(trustline_accounts[1].clone()),
            Some(trustline_accounts[2].clone()),
            Some(trustline_accounts[3].clone()),
            Some(trustline_accounts[4].clone()),
        ),
    ))
}

pub fn require_trustline<'info>(
    scope: &AccountInfo<'info>,
    trustline_enabled: bool,
    validation_engine: Pubkey,
    subject: &AccountInfo<'info>,
    trustline_accounts: &TrustlineRemainingAccounts<'info>,
    scope_signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    if !trustline_enabled {
        return Ok(());
    }

    let global_config = trustline_accounts
        .global_config
        .as_ref()
        .ok_or(VaultError::TrustlineConfigMissing)?;
    let protocol_config = trustline_accounts
        .protocol_config
        .as_ref()
        .ok_or(VaultError::TrustlineConfigMissing)?;
    let approval = trustline_accounts
        .approval
        .as_ref()
        .ok_or(VaultError::TrustlineConfigMissing)?;
    let engine_program = trustline_accounts
        .engine_program
        .as_ref()
        .ok_or(VaultError::TrustlineConfigMissing)?;
    let instructions_sysvar = trustline_accounts
        .instructions_sysvar
        .as_ref()
        .ok_or(VaultError::TrustlineConfigMissing)?;

    require!(
        validation_engine == TRUSTLINE_VALIDATION_ENGINE_ID,
        VaultError::TrustlineEngineMismatch
    );
    require!(
        engine_program.key == &TRUSTLINE_VALIDATION_ENGINE_ID,
        VaultError::TrustlineEngineMismatch
    );
    require!(
        engine_program.executable,
        VaultError::TrustlineAccountMismatch
    );
    require!(
        instructions_sysvar.key == &INSTRUCTIONS_SYSVAR_ID,
        VaultError::TrustlineAccountMismatch
    );

    validate_trailing_trustline_accounts(scope, trustline_accounts)?;
    let fingerprint = current_instruction_fingerprint(scope, instructions_sysvar)?;

    let mut ix_data = Vec::with_capacity(8 + TRUSTLINE_SELECTOR_LEN + 32 + 32);
    ix_data.extend_from_slice(&consume_approval_discriminator());
    ix_data.extend_from_slice(&fingerprint.instruction_selector);
    ix_data.extend_from_slice(&fingerprint.instruction_data_hash);
    ix_data.extend_from_slice(&fingerprint.accounts_hash);

    let ix = Instruction {
        program_id: TRUSTLINE_VALIDATION_ENGINE_ID,
        accounts: vec![
            AccountMeta::new_readonly(*global_config.key, false),
            AccountMeta::new_readonly(*protocol_config.key, false),
            AccountMeta::new(*approval.key, false),
            AccountMeta::new_readonly(*scope.key, true),
            AccountMeta::new_readonly(*subject.key, true),
        ],
        data: ix_data,
    };

    let cpi_accounts = [
        global_config.clone(),
        protocol_config.clone(),
        approval.clone(),
        scope.clone(),
        subject.clone(),
        engine_program.clone(),
    ];

    invoke_signed(&ix, &cpi_accounts, scope_signer_seeds)?;

    Ok(())
}
