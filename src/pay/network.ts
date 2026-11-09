/**
 * Which Sui network x402 payments settle on. Walrus Memory always lives on
 * mainnet; payments default to testnet (free faucet USDC) and switch to
 * mainnet with PAY_NETWORK=mainnet. Every surface labels the network it used.
 */
import { USDC, USDC_TESTNET, type Currency } from "@suimpp/mpp";
import { tatumSui, type SuiNet } from "../tatum/sui.js";

export const payNetwork = (): SuiNet => (process.env.PAY_NETWORK === "mainnet" ? "mainnet" : "testnet");
export const payCurrency = (): Currency => (payNetwork() === "mainnet" ? USDC : USDC_TESTNET);
export const paySui = () => tatumSui(payNetwork());
export const payExplorerTx = (digest: string) => `https://suiscan.xyz/${payNetwork()}/tx/${digest}`;
