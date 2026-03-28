import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  transfer,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { expect } from "chai";
import { Svs13 } from "../target/types/svs_13";

describe("svs-13 (Adapter CPI valuation - sync_total_assets)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Svs13 as Program<Svs13>;
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const vaultId = new BN(7);
  const ADAPTER_ID = new BN(1);
  const ADAPTER_REAL_ASSETS_U64 = new BN(123_456);
  const ASSET_DECIMALS = 6;

  let assetMint: PublicKey;
  let vault: PublicKey;
  let sharesMint: PublicKey;
  let assetVault: PublicKey;

  let userAssetAccount: PublicKey;
  let userSharesAccount: PublicKey;

  let adapterConfig: PublicKey;
  let adapterPosition: PublicKey;

  const ADAPTER_PROGRAM_ID = new PublicKey("11111111111111111111111111111112");

  const getVaultPDA = (assetMint: PublicKey, vaultId: BN): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), assetMint.toBuffer(), vaultId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  };

  const getSharesMintPDA = (vault: PublicKey): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync([Buffer.from("shares"), vault.toBuffer()], program.programId);
  };

  const getAdapterConfigPDA = (vault: PublicKey, adapterId: BN): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("adapter_config"), vault.toBuffer(), adapterId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  };

  const getAdapterPositionPDA = (vault: PublicKey, adapterId: BN): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("adapter_position"), vault.toBuffer(), adapterId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  };

  before(async () => {
    // Create asset mint under the classic SPL Token program (svs-13 asset_vault is an InterfaceAccount<Mint>).
    assetMint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      ASSET_DECIMALS,
      Keypair.generate(),
      undefined,
      TOKEN_PROGRAM_ID
    );

    [vault] = getVaultPDA(assetMint, vaultId);
    [sharesMint] = getSharesMintPDA(vault);

    // User asset account (SPL Token)
    const userAssetAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      assetMint,
      payer.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    userAssetAccount = userAssetAta.address;

    await mintTo(
      connection,
      payer,
      assetMint,
      userAssetAccount,
      payer.publicKey,
      new BN(1_000_000).mul(new BN(10 ** ASSET_DECIMALS)).toNumber(),
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    // Derive vault asset vault ATA (idle liquidity)
    assetVault = getAssociatedTokenAddressSync(
      assetMint,
      vault,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // User shares account must be Token-2022 ATA
    userSharesAccount = getAssociatedTokenAddressSync(
      sharesMint,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Initialize vault
    await program.methods
      .initialize(vaultId, "SVS-13 Vault", "SVS13", "https://example.com/vault")
      .accountsStrict({
        authority: payer.publicKey,
        vault,
        assetMint,
        sharesMint,
        assetVault,
        assetTokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // Register mock adapter
    [adapterConfig] = getAdapterConfigPDA(vault, ADAPTER_ID);
    [adapterPosition] = getAdapterPositionPDA(vault, ADAPTER_ID);

    await program.methods
      .addAdapter(ADAPTER_ID, ADAPTER_PROGRAM_ID, ADAPTER_REAL_ASSETS_U64)
      .accountsStrict({
        vault,
        authority: payer.publicKey,
        adapterConfig,
        adapterPosition,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // NOTE: `addAdapter(adapterId, adapterProgram, maxAllocationAbs)`
    // If your test fails due to argument ordering, check `svs_13` IDL.
  });

  it("sync_total_assets() uses CPI return data (Option A)", async () => {
    const depositAmount = new BN(10_000).mul(new BN(10 ** ASSET_DECIMALS));

    // Deposit to create idle assets
    await program.methods
      .deposit(depositAmount, new BN(0))
      .accountsStrict({
        user: payer.publicKey,
        vault,
        assetMint,
        userAssetAccount,
        assetVault,
        sharesMint,
        userSharesAccount,
        assetTokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const vaultBefore = await program.account.vault.fetch(vault);
    const idleBefore = (await getAccount(connection, assetVault)).amount;

    // Remaining accounts per adapter_id:
    // (adapter_config, adapter_position, adapter_holding)
    await program.methods
      .syncTotalAssets([ADAPTER_ID])
      .accountsStrict({
        curator: payer.publicKey,
        vault,
        assetVault,
      })
      .remainingAccounts([
        { pubkey: adapterConfig, isSigner: false, isWritable: false },
        { pubkey: adapterPosition, isSigner: false, isWritable: true },
        { pubkey: assetVault, isSigner: false, isWritable: false },
      ])
      .rpc();

    const vaultAfter = await program.account.vault.fetch(vault);
    const posAfter = await program.account.adapterPosition.fetch(adapterPosition);

    expect(vaultAfter.totalAssets.toNumber()).to.equal(
      Number(idleBefore) + ADAPTER_REAL_ASSETS_U64.toNumber()
    );
    expect(posAfter.lastReportedAssets.toNumber()).to.equal(ADAPTER_REAL_ASSETS_U64.toNumber());
    expect(posAfter.lastReportedSlot.toNumber()).to.be.greaterThan(0);
  });
});

