import * as anchor from "@coral-xyz/anchor";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ACCOUNT_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createInitializeAccount3Instruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";
import svs13Idl from "../target/idl/svs_13.json";
import mockIdl from "../target/idl/svs_13_adapter_mock.json";
import trustlineIdl from "../target/idl/trustline_validation_engine.json";

const USDC_DEVNET_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const DEFAULT_VAULT_NAME = "USDC Trustline Vault";
const DEFAULT_VAULT_SYMBOL = "svUSDC";
const DEFAULT_VAULT_URI = "https://example.com/svusdc";
const DEFAULT_ADAPTER_ID = "1";
const DEFAULT_ADAPTER_CAP = "0";
const RAW_INSTRUCTION_FINGERPRINT_V1 = 1;
const DEFAULT_AUTO_VALIDITY_SECS = "300";
const DEFAULT_MANUAL_VALIDITY_SECS = "3600";
const DEFAULT_DOMAIN_SEPARATOR = "trustline-solana-devnet-v1";
const BACKEND_AUTHORITY_ADDRESS = new PublicKey("8cGNg5XTqadXRkMEy28FKHPAi4DmFkphQyitFkPsWbpm");

function banner(title: string): void {
  console.log(`\n== ${title} ==`);
}

function expandHome(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function getDefaultSolanaWalletPath(): string {
  const envWallet = process.env.ANCHOR_WALLET || process.env.SOLANA_KEYPAIR_PATH;
  if (envWallet) {
    return expandHome(envWallet);
  }

  const cliConfigPath = path.join(os.homedir(), ".config/solana/cli/config.yml");
  if (fs.existsSync(cliConfigPath)) {
    const configText = fs.readFileSync(cliConfigPath, "utf8");
    const match = configText.match(/keypair_path:\s*(.+)/);
    if (match?.[1]) {
      return expandHome(match[1].trim());
    }
  }

  return path.join(os.homedir(), ".config/solana/id.json");
}

function loadLocalWallet(): anchor.Wallet {
  const walletPath = getDefaultSolanaWalletPath();
  if (!fs.existsSync(walletPath)) {
    throw new Error(
      `Could not find a local keypair at ${walletPath}. Set ANCHOR_WALLET or configure Solana CLI first.`
    );
  }

  const secret = JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[];
  const keypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  console.log("Using wallet file:", walletPath);
  return new anchor.Wallet(keypair);
}

function getEnvOrDefault(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function parsePubkeyEnv(name: string, fallback: PublicKey): PublicKey {
  const raw = process.env[name]?.trim();
  return raw ? new PublicKey(raw) : fallback;
}

function sha256Bytes(input: string): number[] {
  return Array.from(crypto.createHash("sha256").update(input).digest());
}

async function main() {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const wallet = loadLocalWallet();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const svs13Program = new anchor.Program(svs13Idl as anchor.Idl, provider);
  const trustlineProgram = new anchor.Program(trustlineIdl as anchor.Idl, provider);
  const mockProgramId = new PublicKey(mockIdl.address);
  const payer = wallet.payer;

  const vaultName = getEnvOrDefault("SVS13_VAULT_NAME", DEFAULT_VAULT_NAME);
  const vaultSymbol = getEnvOrDefault("SVS13_VAULT_SYMBOL", DEFAULT_VAULT_SYMBOL);
  const vaultUri = getEnvOrDefault("SVS13_VAULT_URI", DEFAULT_VAULT_URI);
  const adapterId = new anchor.BN(getEnvOrDefault("SVS13_ADAPTER_ID", DEFAULT_ADAPTER_ID));
  const adapterCap = new anchor.BN(getEnvOrDefault("SVS13_ADAPTER_CAP", DEFAULT_ADAPTER_CAP));

  const publisherAuthority = parsePubkeyEnv(
    "TRUSTLINE_PUBLISHER_AUTHORITY",
    BACKEND_AUTHORITY_ADDRESS
  );
  const auditorAuthority = parsePubkeyEnv("TRUSTLINE_AUDITOR_AUTHORITY", payer.publicKey);
  const autoValiditySecs = new anchor.BN(
    getEnvOrDefault("TRUSTLINE_AUTO_VALIDITY_SECS", DEFAULT_AUTO_VALIDITY_SECS)
  );
  const manualValiditySecs = new anchor.BN(
    getEnvOrDefault("TRUSTLINE_MANUAL_VALIDITY_SECS", DEFAULT_MANUAL_VALIDITY_SECS)
  );
  const domainSeparatorLabel = getEnvOrDefault(
    "TRUSTLINE_DOMAIN_SEPARATOR",
    DEFAULT_DOMAIN_SEPARATOR
  );

  banner("Wallet");
  console.log("Address:", payer.publicKey.toBase58());
  const balanceLamports = await connection.getBalance(payer.publicKey);
  console.log("Balance:", (balanceLamports / 1e9).toFixed(4), "SOL");
  if (balanceLamports < 0.1 * 1e9) {
    throw new Error("Not enough devnet SOL. Run `solana airdrop 2` and retry.");
  }

  banner("Programs");
  console.log("SVS-13 Program:   ", svs13Program.programId.toBase58());
  console.log("Mock Adapter:     ", mockProgramId.toBase58());
  console.log("Trustline Engine: ", trustlineProgram.programId.toBase58());

  banner("USDC Mint");
  const assetMint = parsePubkeyEnv("SVS13_ASSET_MINT", USDC_DEVNET_MINT);
  const assetMintInfo = await connection.getAccountInfo(assetMint);
  if (!assetMintInfo) {
    throw new Error(`Asset mint ${assetMint.toBase58()} not found on devnet.`);
  }
  const assetTokenProgram = assetMintInfo.owner;
  console.log("Asset mint:", assetMint.toBase58());
  console.log("Asset token program:", assetTokenProgram.toBase58());

  banner("Derive Vault Accounts");
  const vaultId = new anchor.BN(Date.now());
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), assetMint.toBuffer(), vaultId.toArrayLike(Buffer, "le", 8)],
    svs13Program.programId
  );
  const [sharesMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("shares"), vault.toBuffer()],
    svs13Program.programId
  );
  const assetVault = getAssociatedTokenAddressSync(
    assetMint,
    vault,
    true,
    assetTokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  console.log("Vault ID:", vaultId.toString());
  console.log("Vault:", vault.toBase58());
  console.log("Shares mint:", sharesMint.toBase58());
  console.log("Asset vault:", assetVault.toBase58());

  banner("Initialize Vault");
  await (svs13Program.methods as any)
    .initialize(vaultId, vaultName, vaultSymbol, vaultUri)
    .accountsStrict({
      authority: payer.publicKey,
      vault,
      assetMint,
      sharesMint,
      assetVault,
      assetTokenProgram,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
  console.log("Vault initialized.");

  banner("Create Adapter Accounts");
  const [adapterConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("adapter_config"), vault.toBuffer(), adapterId.toArrayLike(Buffer, "le", 8)],
    svs13Program.programId
  );
  const [adapterPosition] = PublicKey.findProgramAddressSync(
    [Buffer.from("adapter_position"), vault.toBuffer(), adapterId.toArrayLike(Buffer, "le", 8)],
    svs13Program.programId
  );
  const adapterHolding = Keypair.generate();
  const rentLamports = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
  const createHoldingTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: adapterHolding.publicKey,
      lamports: rentLamports,
      space: ACCOUNT_SIZE,
      programId: assetTokenProgram,
    }),
    createInitializeAccount3Instruction(
      adapterHolding.publicKey,
      assetMint,
      vault,
      assetTokenProgram
    )
  );
  await provider.sendAndConfirm(createHoldingTx, [adapterHolding], {
    commitment: "confirmed",
  });
  console.log("Adapter holding:", adapterHolding.publicKey.toBase58());

  banner("Register Mock Adapter");
  await (svs13Program.methods as any)
    .addAdapter(adapterId, mockProgramId, adapterCap)
    .accountsStrict({
      vault,
      authority: payer.publicKey,
      adapterConfig,
      adapterPosition,
      adapterHolding: adapterHolding.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await (svs13Program.methods as any)
    .setLiquidityAdapter(adapterId)
    .accountsStrict({
      vault,
      curator: payer.publicKey,
    })
    .rpc();
  console.log("Adapter registered and set as liquidity adapter.");

  banner("Trustline Global / Protocol Config");
  const [globalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    trustlineProgram.programId
  );
  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config"), svs13Program.programId.toBuffer()],
    trustlineProgram.programId
  );
  const globalExists = !!(await connection.getAccountInfo(globalConfig));
  const protocolExists = !!(await connection.getAccountInfo(protocolConfig));

  if (!globalExists) {
    await (trustlineProgram.methods as any)
      .initializeGlobalConfig(
        publisherAuthority,
        auditorAuthority,
        sha256Bytes(domainSeparatorLabel),
        autoValiditySecs,
        manualValiditySecs
      )
      .accountsStrict({
        admin: payer.publicKey,
        globalConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Initialized global config.");
  } else {
    await (trustlineProgram.methods as any)
      .updateGlobalConfig(
        publisherAuthority,
        auditorAuthority,
        true,
        false,
        autoValiditySecs,
        manualValiditySecs
      )
      .accountsStrict({
        admin: payer.publicKey,
        globalConfig,
      })
      .rpc();
    console.log("Updated global config.");
  }

  if (!protocolExists) {
    await (trustlineProgram.methods as any)
      .initializeProtocolConfig(RAW_INSTRUCTION_FINGERPRINT_V1)
      .accountsStrict({
        admin: payer.publicKey,
        globalConfig,
        protectedProgram: svs13Program.programId,
        protocolConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Initialized protocol config.");
  } else {
    await (trustlineProgram.methods as any)
      .updateProtocolConfig(true, RAW_INSTRUCTION_FINGERPRINT_V1)
      .accountsStrict({
        admin: payer.publicKey,
        globalConfig,
        protocolConfig,
      })
      .rpc();
    console.log("Updated protocol config.");
  }

  banner("Enable Trustline On Vault");
  await (svs13Program.methods as any)
    .setTrustlineConfig(trustlineProgram.programId, true)
    .accountsStrict({
      authority: payer.publicKey,
      vault,
    })
    .rpc();
  console.log("Trustline enabled on vault.");

  banner("Done");
  console.log("USDC vault initialized with mock adapter and Trustline enabled.");
  console.log("\nUseful values:");
  console.log(`Program ID          : ${svs13Program.programId.toBase58()}`);
  console.log(`Vault               : ${vault.toBase58()}`);
  console.log(`Vault ID            : ${vaultId.toString()}`);
  console.log(`Asset Mint          : ${assetMint.toBase58()}`);
  console.log(`Shares Mint         : ${sharesMint.toBase58()}`);
  console.log(`Asset Vault         : ${assetVault.toBase58()}`);
  console.log(`Adapter ID          : ${adapterId.toString()}`);
  console.log(`Adapter Config      : ${adapterConfig.toBase58()}`);
  console.log(`Adapter Position    : ${adapterPosition.toBase58()}`);
  console.log(`Adapter Holding     : ${adapterHolding.publicKey.toBase58()}`);
  console.log(`Global Config       : ${globalConfig.toBase58()}`);
  console.log(`Protocol Config     : ${protocolConfig.toBase58()}`);
  console.log(`Publisher Authority : ${publisherAuthority.toBase58()}`);
  console.log(`Auditor Authority   : ${auditorAuthority.toBase58()}`);
}

main().catch((error) => {
  console.error("\nUSDC vault setup failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

