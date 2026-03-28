# SVS-13: Adapter Vault (CPI-Valued Yield Aggregator)

## Status: Draft
## Authors: Trustline
## Date: 2026-03-18
## Base: SVS-2 (Stored Balance)

---

## 1. Overview

SVS-13 is a stored-balance vault designed for **yield generation via adapters**. Users deposit/withdraw synchronously like SVS-2, while a set of privileged roles (allocator/curator) can **allocate idle assets** to multiple adapter programs (lending, staking, LP, structured products, etc.).

The key feature is **CPI-based valuation**: the vault maintains `total_assets` as a cached NAV and refreshes it by calling each adapter’s `real_assets()` (or equivalent) instruction via CPI and reading the result from **Solana return data**.

---

## 2. How It Differs from SVS-1 / SVS-2

| Aspect | SVS-1 (Live) | SVS-2 (Stored + sync) | SVS-13 (Stored + Adapter NAV) |
|--------|--------------|------------------------|-------------------------------|
| Assets location | Always in vault ATA | Can leave ATA | Can leave ATA (to adapters) |
| `total_assets` meaning | `asset_vault.amount` | Cached, synced to ATA | Cached NAV = idle + Σ adapter values |
| Yield recognition | Instant (donations) | Authority-controlled `sync()` | Curator/allocator-controlled `sync_total_assets()` |
| Strategy execution | N/A | External/off-chain | On-chain CPI to adapter programs |
| Valuation | Token account balance | Token account balance | CPI valuation (return data) |

SVS-13 keeps SVS-2’s **stored balance model**, but replaces “sync to ATA balance” with “sync to adapter-reported NAV”.

---

## 3. Roles & Permissions

SVS-13 separates responsibilities to reduce blast radius:

- **Authority**: Vault admin. Can add/remove adapters, set caps, pause, and change roles.
- **Curator**: Risk manager. Can enable/disable adapters, adjust caps/weights, and run `sync_total_assets()`.
- **Allocator**: Execution role. Can call `allocate` / `deallocate` within curator-defined constraints.

---

## 4. Adapter Model

An **adapter** is an on-chain program that:

1. Accepts allocations from the vault (assets transferred to adapter-controlled accounts).
2. Manages positions in external protocols via CPI (or internal logic).
3. Exposes a standard valuation interface returning the **current value in base assets**.

SVS-13 treats adapters as *trusted plugins* selected by the vault authority/curator. The vault must therefore:

- pin adapter **program IDs** in an on-chain registry (no substitution)
- enforce **caps** (absolute only) per adapter
- support an optional **liquidity adapter**

---

## 5. Standard Adapter CPI Interfaces

SVS-13 defines a minimal CPI interface that adapters must implement.

### 5.1 `real_assets()` (valuation)

The vault calls `adapter::real_assets()` to retrieve the adapter’s current position value denominated in the vault’s `asset_mint`.

**Return mechanism**: the adapter sets return data (via `solana_program::program::set_return_data`) to an 8-byte little-endian `u64`.

ABI:

```
real_assets_return_data: u64  // value in base-asset smallest units
// total: 8 bytes
```

Trusted-adapter validation:
- adapter program ID matches the pinned registry entry
- return data can be parsed as exactly one `u64`

### 5.2 `allocate()` / `deallocate()` (position changes)

Adapters should expose CPI entrypoints for:

```
allocate(amount: u64, data: Vec<u8>) -> Result<()>
deallocate(amount: u64, data: Vec<u8>) -> Result<u64>  // may return assets received via return data
```

SVS-13 does not require a single universal data format. Adapters can interpret `data` as protocol-specific parameters (slippage, market selection, etc.). The vault enforces *who can call* and *how much can move*, not *how adapters execute*.

---

## 6. State

### 6.1 Vault State

```rust
#[account]
pub struct AdapterVault {
    // ── Core vault fields (SVS-2 compatible) ──
    pub authority: Pubkey,
    pub asset_mint: Pubkey,
    pub shares_mint: Pubkey,
    pub asset_vault: Pubkey,     // idle assets ATA (PDA-owned)
    pub total_assets: u64,       // cached NAV (idle + adapters)
    pub total_shares: u64,
    pub decimals_offset: u8,
    pub bump: u8,
    pub paused: bool,
    pub vault_id: u64,

    // ── SVS-13 fields ──
    pub curator: Pubkey,
    pub allocator: Pubkey,
    pub max_adapters: u8,        // e.g., 16
    pub num_adapters: u8,
    pub liquidity_adapter_id: Option<u64>, // when set, deposits go directly to this adapter
    pub last_sync_slot: u64,
    pub _reserved: [u8; 64],
}
// seeds: ["adapter_vault", asset_mint, vault_id.to_le_bytes()]
```

Notes:
- `asset_vault` holds **idle liquidity** only. Allocated capital lives in adapter-controlled accounts.
- `total_assets` is updated by `sync_total_assets()` and by deposit/withdraw arithmetic where safe.

### 6.2 Adapter Registry Entry

```rust
#[account]
pub struct AdapterConfig {
    pub vault: Pubkey,
    pub adapter_id: u64,         // stable identifier within vault
    pub adapter_program: Pubkey, // pinned program id
    pub enabled: bool,

    // Caps (risk controls)
    pub max_allocation_abs: u64, // absolute cap in asset units (0 = none)

    // Optional metadata
    pub name: [u8; 32],          // optional UTF-8, truncated/padded
    pub bump: u8,
    pub _reserved: [u8; 32],
}
// seeds: ["adapter_config", vault_pda, adapter_id.to_le_bytes()]
```

### 6.3 Adapter Position Tracking

```rust
#[account]
pub struct AdapterPosition {
    pub vault: Pubkey,
    pub adapter_id: u64,

    // Cost basis and accounting
    pub principal_deployed: u64, // cumulative net allocated (alloc - dealloc)
    pub last_reported_assets: u64,
    pub last_reported_slot: u64,

    // Optional: adapter-specific receipt tracking
    pub receipt_mint: Option<Pubkey>,
    pub receipt_vault: Option<Pubkey>, // token account holding receipts (owned by vault PDA or adapter PDA)

    pub bump: u8,
    pub _reserved: [u8; 32],
}
// seeds: ["adapter_position", vault_pda, adapter_id.to_le_bytes()]
```

---

## 7. Total Assets (NAV) Computation

SVS-13 defines:

```
NAV = idle_assets + Σ real_assets(adapter_i)
```

Where:
- `idle_assets = asset_vault.amount`
- `real_assets(adapter_i)` is obtained by CPI calling adapter `real_assets()` and reading return data as `u64`.

### 7.1 `sync_total_assets()`

`sync_total_assets()` updates:
- `vault.total_assets`
- each `AdapterPosition.last_reported_assets/slot`
- `vault.last_sync_slot`

This is the authoritative way yield/loss is recognized.

---

## 8. Instruction Set

| # | Instruction | Signer | Description |
|---|------------|--------|-------------|
| 1 | `initialize` | Authority | Creates AdapterVault PDA, shares mint, idle asset vault |
| 2 | `deposit` | User | Transfer assets to idle vault, mint shares using stored NAV |
| 3 | `mint` | User | Mint exact shares, pay assets using stored NAV |
| 4 | `withdraw` | User | Withdraw assets from idle vault, burn shares using stored NAV |
| 5 | `redeem` | User | Redeem shares for assets from idle vault using stored NAV |
| 6 | `add_adapter` | Authority | Register adapter program + create config/position PDAs |
| 7 | `remove_adapter` | Authority | Remove adapter (must be fully deallocated) |
| 8 | `set_roles` | Authority | Set curator/allocator |
| 9 | `set_liquidity_adapter` | Curator | Choose the liquidity adapter (or disable by setting `None`) |
| 10 | `set_adapter_caps` | Curator | Set per-adapter absolute caps/limits |
| 11 | `enable_adapter` / `disable_adapter` | Curator | Turn adapter on/off |
| 12 | `allocate` | Allocator | Move idle assets into adapter (vault transfers then CPI) |
| 13 | `deallocate` | Allocator | Recall assets from adapter (transfer then CPI) |
| 14 | `sync_total_assets` | Curator | Refresh NAV by CPI valuation of all enabled adapters |
| 15 | `pause` / `unpause` | Authority | Emergency controls |
| 16 | `transfer_authority` | Authority | Transfer vault admin |

### 8.1 `deposit` / `redeem` liquidity rule

**Deposit: liquidity adapter.**

- If `liquidity_adapter_id` is set and that adapter is enabled, deposit/mint sends the deposited assets directly to that adapter holding account and immediately CPI-calls the adapter `allocate(amount, data=[])`.
- If `liquidity_adapter_id` is unset, deposit/mint first increases idle assets in `asset_vault` and allocations happen later via `allocate()`.

**Redeem/withdraw: idle assets only.**

SVS-13 user redemptions draw from **idle assets only**:

- If idle liquidity is insufficient, user withdraw/redeem fails with `InsufficientLiquidity`.
- The allocator must first `deallocate()` from adapters to replenish idle funds.

This mirrors the SVS-9 reasoning: auto-deallocation in user flows is unpredictable in compute and account requirements.

### 8.2 `allocate`

For user transparency, the adapter holding token account is a deterministic PDA derived from `(vault, adapter_id)`, so anyone can precompute it and monitor its token balance to track deployed funds.

```
allocate(adapter_id: u64, amount: u64, data: Vec<u8>):
  ✓ vault not paused
  ✓ signer == vault.allocator (or authority)
  ✓ AdapterConfig exists, enabled
  ✓ amount > 0
  ✓ adapter_allocation_after <= adapter max_allocation_abs (0 = no cap)

  // Pattern 1 plumbing: vault transfers tokens, then CPI.
  // The vault transfers from its `asset_vault` to a deterministic adapter holding token account,
  // then calls into the adapter program to update its internal position state.
  → Transfer `amount` from vault.asset_vault to adapter holding token account (PDA derived from (vault, adapter_id))
  → CPI: adapter_program::allocate(amount, data)  // adapter sees tokens already in its holding account

  → Update AdapterPosition.principal_deployed += amount
  → emit Allocate { vault, adapter_id, amount }
```

### 8.3 `deallocate`

```
deallocate(adapter_id: u64, amount: u64, data: Vec<u8>):
  ✓ signer == vault.allocator (or authority)
  ✓ AdapterConfig exists
  // Vault PDA-owned holding: vault transfers then CPI.
  → Transfer `amount` from adapter holding token account back to vault.asset_vault
  → CPI: adapter_program::deallocate(amount, data)
  → Update AdapterPosition.principal_deployed -= amount
  → emit Deallocate { vault, adapter_id, amount }
```

### 8.4 `sync_total_assets`

```
sync_total_assets():
  ✓ signer == vault.curator (or authority)
  → For each enabled adapter:
      // remaining_accounts (Option A):
      //   [(adapter_config), (adapter_position), (adapter_holding)] per adapter_id
       CPI: adapter_program::real_assets()
       read return data as u64 real_assets
       update AdapterPosition.last_reported_assets/slot
  → vault.total_assets = idle_assets + Σ real_assets
  → vault.last_sync_slot = current_slot
  → emit NavSync { vault, total_assets, num_adapters }
```

---

## 9. Math & Rounding

All ERC-4626 conversions use SVS math (`svs-math`):

- `deposit`: floor shares (vault-favoring)
- `mint`: ceiling assets (vault-favoring)
- `withdraw`: ceiling shares (vault-favoring)
- `redeem`: floor assets (vault-favoring)

Virtual offset inflation-attack protection remains unchanged.

---

## 10. Caps & Risk Controls

SVS-13 enforces:

- **Per-adapter caps**
  - `max_allocation_abs` (absolute, 0 = none)
- **Emergency disable**
  - curator can disable an adapter to block new allocations

Future extensions:
- **ID & Cap system** grouping adapters by risk factors
- timelocked curator actions for changes that increase risk

---

## 11. Module Compatibility

**Implementation:** Build with `--features modules`. Module config PDAs passed via `remaining_accounts` (same mechanism as SVS-1/SVS-2).

- **svs-fees:** Management fee accrues on `vault.total_assets` (NAV). Performance fee can use NAV/share high-water mark.
- **svs-caps:** Global caps check against NAV. Per-user caps check against deposit amounts as usual.
- **svs-locks:** Locks apply to SVS-13 shares the same way as other variants.
- **svs-access:** Access/freeze checks apply to deposit/withdraw paths (and optionally to allocate/deallocate if desired).
- **svs-rewards:** Optional secondary rewards distribution independent of adapter yield.

---

## 12. Security Considerations

- **Adapter program substitution:** Adapter registry must pin `adapter_program` and validate `AccountInfo.owner` / program id for every CPI.
- **Malicious valuation:** `real_assets()` can lie. SVS-13 assumes adapters are curated/trusted. Deployments that need trust minimization should use:
  - objective valuation sources (verifiable receipts + oracle)
  - conservative caps
  - timelocked enabling/cap increases
- **Compute griefing:** CPI valuation across many adapters increases CU. Enforce `max_adapters` (current code synces all enabled adapters each call).
- **Liquidity risk:** User withdrawals rely on idle liquidity. With no idle buffer, operational procedures and conservative caps are the main mitigation.

---

## 13. Compute Budget Estimates (Rough)

| Operation | Approximate CU | Notes |
|----------|-----------------|------|
| `deposit` / `redeem` | ~30k–45k | Similar to SVS-2; no CPI |
| `allocate` / `deallocate` | ~60k–200k | CPI to adapter + protocol CPIs inside adapter |
| `sync_total_assets` | ~20k + (CPI per adapter) | Depends on adapter `real_assets()` complexity |

Practical guidance:
- keep `real_assets()` lightweight and deterministic
- cap adapters at 8–16 per vault

---

## See Also

- [SVS-2](./SVS-2.md) — Stored balance base model
- [SVS-9](./specs-SVS09.md) — Allocator vault-of-vaults (child-vault “adapter” alternative)
- [MODULES.md](./MODULES.md) — Optional module system
