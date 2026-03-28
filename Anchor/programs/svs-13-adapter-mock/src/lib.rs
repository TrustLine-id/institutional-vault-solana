use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;

declare_id!("7Y5fWW5Z4wiyJrtxmwuSN72wSBaBDq3zY4H7FCCm68ut");

#[program]
pub mod svs_13_adapter_mock {
    use super::*;

    /// Mock adapter allocation endpoint.
    ///
    /// This mock doesn't manage any internal state; it just succeeds so the
    /// SVS-13 CPI plumbing can be tested.
    pub fn allocate(_ctx: Context<Allocate>, _amount: u64, _data: Vec<u8>) -> Result<()> {
        Ok(())
    }

    /// Mock adapter deallocation endpoint.
    ///
    /// Returns the recalled assets as `amount` to match the optional ABI.
    pub fn deallocate(_ctx: Context<Deallocate>, amount: u64, _data: Vec<u8>) -> Result<u64> {
        // SVS-13 deallocation reconciliation expects u64 return data.
        set_return_data(&amount.to_le_bytes());
        Ok(amount)
    }

    /// Mock adapter valuation endpoint.
    ///
    /// Returns the current token balance of the adapter holding account as the
    /// adapter's managed assets.
    pub fn real_assets(ctx: Context<RealAssets>) -> Result<()> {
        let holding_data = ctx.accounts.adapter_holding.try_borrow_data()?;
        require!(holding_data.len() >= 72, MockError::InvalidAdapterHolding);

        let mut amount_bytes = [0u8; 8];
        amount_bytes.copy_from_slice(&holding_data[64..72]);
        let amount = u64::from_le_bytes(amount_bytes);

        set_return_data(&amount.to_le_bytes());
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RealAssets<'info> {
    /// CHECK: Mock adapter parses `AdapterConfig` from fixed byte offsets.
    #[account()]
    pub adapter_config: AccountInfo<'info>,

    /// CHECK: Unused by mock valuation.
    #[account()]
    pub adapter_position: AccountInfo<'info>,

    /// CHECK: Unused by mock valuation.
    #[account()]
    pub adapter_holding: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Allocate<'info> {
    /// CHECK: Mock adapter doesn't validate these accounts; SVS-13 is trusted in MVP.
    #[account()]
    pub adapter_config: AccountInfo<'info>,

    /// CHECK
    #[account()]
    pub adapter_position: AccountInfo<'info>,

    /// CHECK
    #[account()]
    pub adapter_holding: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Deallocate<'info> {
    /// CHECK: Mock adapter doesn't validate these accounts; SVS-13 is trusted in MVP.
    #[account()]
    pub adapter_config: AccountInfo<'info>,

    /// CHECK
    #[account()]
    pub adapter_position: AccountInfo<'info>,

    /// CHECK
    #[account()]
    pub adapter_holding: AccountInfo<'info>,
}

#[error_code]
pub enum MockError {
    #[msg("Invalid adapter holding account data")]
    InvalidAdapterHolding,
}
