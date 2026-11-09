/**
 * Moves the bot's share from the server wallet (SUI for gas, USDC to spend)
 * and deposits the bot's USDC into its address balance, which x402's gasless
 * transfer spends from. All through Tatum's Sui gRPC gateway.
 *
 *   npx tsx scripts/fund_bot.ts [sui=1] [usdc=3]
 *   npx tsx scripts/fund_bot.ts --deposit-only [usdc]   (bot already holds USDC coins, e.g. from a faucet)
 */
import "dotenv/config";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { config } from "../src/config.js";
import { payCurrency, payExplorerTx, paySui } from "../src/pay/network.js";
import { depositToAddressBalance, usdcBalances } from "../src/bot/client.js";

const depositOnly = process.argv.includes("--deposit-only");
const [sui = "1", usdc = "3"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const server = Ed25519Keypair.fromSecretKey(config.serverKey);
const bot = Ed25519Keypair.fromSecretKey(config.botKey);
const client = paySui();
const USDC = payCurrency();

if (depositOnly) {
  const amount = Number(process.argv.slice(2).filter((a) => !a.startsWith("--"))[0] ?? (await usdcBalances(bot.toSuiAddress())).coins);
  console.log(`bot USDC → address balance  ${payExplorerTx(await depositToAddressBalance(bot, amount))}`);
  process.exit(0);
}

const tx = new Transaction();
tx.setSender(server.toSuiAddress());
const [gas] = tx.splitCoins(tx.gas, [BigInt(Math.round(Number(sui) * 1e9))]);
tx.transferObjects([gas, coinWithBalance({ type: USDC.type, balance: BigInt(Math.round(Number(usdc) * 1e6)), useGasCoin: false })], bot.toSuiAddress());
const res = await client.signAndExecuteTransaction({ transaction: tx, signer: server, include: { effects: true } });
const t = res.Transaction ?? res.FailedTransaction;
if (!t?.effects?.status.success) throw new Error(`transfer failed: ${JSON.stringify(t?.effects?.status ?? res).slice(0, 300)}`);
console.log(`server → bot: ${sui} SUI + ${usdc} USDC  ${payExplorerTx(t.digest)}`);
await client.waitForTransaction({ digest: t.digest });

const dep = await depositToAddressBalance(bot, Number(usdc));
console.log(`bot USDC → address balance  ${payExplorerTx(dep)}`);
console.log("bot USDC:", await usdcBalances(bot.toSuiAddress()));
