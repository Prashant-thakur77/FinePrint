# Fine Print

Fine Print checks a market's rules against past rulings before you buy.

Live: https://fineprint.prashantthakur.dev · Report: [eval/REPORT.md](eval/REPORT.md) · Smoke tests: [docs/smoke.md](docs/smoke.md)

## The trade that started it

On 1 June 2026, Strategy's 8-K showed 32 BTC sold between 26 and 31 May. On Polymarket, "MicroStrategy sells any Bitcoin by May 31, 2026?" (Gamma market 2169995) went from about 11c to 81c by 12:12 UTC. From 12:20 it traded between 41c and 82c for 4h 39m.

At 14:13 UTC the question's owner posted a notice on the UMA adapter's bulletin board on Polygon: a clarification might come at 1 PM ET. At 17:00:16 UTC it came: "Confirmation achieved outside of the market's time frame does not qualify." YES went from 53c at 16:59 to 0.6c at 17:01. UMA settled NO on 3 June. The top YES holder says he lost about USD 500k ([DeFi Rate](https://defirate.com/news/polymarket-trader-loses-500k-loss-after-rules-change-microstrategy-btc-market/)), and traders sued in New York on 3 July over about USD 6.5M ([casino.org](https://www.casino.org/news/polymarket-sued-by-traders-claiming-6-5m-scam-over-bitcoin-prediction-market/)).

Nobody showed him market 516926, "MicroStrategy sells any Bitcoin in 2025?". Same rule wording. Its UMA history reads proposed, disputed, proposed, disputed, and it resolved NO.

Fine Print is the check that would have shown it. Ask it about market 2169995 as of 12:20 UTC on 1 June, using only markets that had closed by then, and it rules DISPUTE RISK HIGH and cites 516926 by its Walrus blob. A bot that asks before buying at 81c skips the trade.

The prices, the timeline and the two on-chain posts come from scripts in this repo: [eval/mstr_story.ts](eval/mstr_story.ts) and [scripts/lineage.ts](scripts/lineage.ts).

## What it does

One engine, three ways in.

The trader view takes any Polymarket link or id. It draws the real price chart from Tatum's Prediction Market API, recalls the closest precedents from Walrus Memory, and pins the ruling on the chart with the blob IDs it cites. Grey pins mark each version of the rules, read from the chain, so you can see which version you bought under. A memory switch shows the same market ruled on rule text alone.

The court endpoint is for bots. `GET /api/ruling?market=<id>` answers 402. The bot pays 0.02 USDC on Sui with x402 and gets a sealed, cited ruling. If a LOW ruling is followed by a dispute, or by the outcome the crowd priced as less likely, the fee goes back to the payer. The price per wording pattern follows the court's graded accuracy for that pattern, between 0.01 and 0.05 USDC.

The rule-version feed hashes the rules of watched markets every 15 minutes and stores each real change as a memory. For markets it wasn't watching, it rebuilds the lineage from the UMA adapter's `AncillaryDataUpdated` logs on Polygon.

## How it works

```
Polymarket market ──► Tatum Prediction Market API (rules, price history)
        │
        ├──► wording patterns (regex over title + rules)
        │
        ├──► Walrus Memory recall ──► precedents closed before "as of"
        │        (PRECEDENTS account)    + latest pattern evidence
        │                                + court track record per pattern
        ▼
   judge (one LLM call, market text fenced as untrusted data,
          must cite blob IDs it was given, uncited HIGH/MED refused)
        │
        ├──► RULING memory sealed on Walrus before the outcome (COURT account)
        ├──► x402: 402 → signed USDC transfer → settled via Tatum's Sui gateway
        │
   market resolves ──► grade ──► GRADE memory, price board moves,
                                  refund if a paid LOW ruling was wrong,
                                  outcome written back as a new PRECEDENT
```

Walrus Memory holds everything the court knows, on Sui mainnet, in three MemWal accounts:

| Account | Namespaces | What a memory is |
|---|---|---|
| PRECEDENTS | `precedents`, `patterns` | one resolved market distilled (key clause, source, crowd price 24h before close, UMA status sequence, outcome), and one learned wording pattern with its evidence count |
| COURT | `rulings`, `track`, `replay-rulings` | a ruling sealed before the outcome, and its grade |
| USER | `rules/<conditionId>` | one version of a market's rules |

Recall is semantic only, so the close date lives inside each memory's text and the leakage guard filters on it after recall.

Tatum does three jobs. Its Prediction Market API gives rules, outcomes and minute history (`source=midpoint`). Its Polygon RPC reads the UMA adapters' bulletin board and the Optimistic Oracle's `DisputePrice` events. Its Sui GraphQL gateway settles and re-checks every payment.

x402 uses the `exact` scheme with USDC: the bot signs a gasless address-balance transfer, the server submits it and confirms the balance change, and each challenge and digest can be used once.

## Numbers

Every number below is copied from `eval/results/` by `scripts/export_results.ts`. The commands that produced them are in [eval/REPORT.md](eval/REPORT.md).

<!-- numbers:start -->
Pending: generated when the evaluation runs finish.
<!-- numbers:end -->

## Honest limits

Payments run on Sui testnet. Walrus Memory, the precedents, the rulings and the rule versions are all on mainnet, but I chose not to spend real money on this entry, so the x402 payments and refunds use Circle's testnet USDC. Switching is one setting (`PAY_NETWORK=mainnet`) and a funded wallet. Every receipt and explorer link says which network it used.

A rule-change alert on its own could not have saved the MSTR holder. The clarification and the reprice happened in the same two minutes. The only usable window was before the buy, which is where Fine Print sits.

Dispute labels come from Gamma's UMA status history (`umaResolutionStatuses`). I read on-chain `DisputePrice` events for the demo market, but not for the whole dataset.

The crawl missed some end-date days. Gamma rate-limited or refused them on every pass, and `eval/results/dataset_summary.json` lists them.

Recall finds wording that looks alike. When no precedent is close, the ruling falls back to the rule text, and the report shows how accuracy splits between markets with and without precedents.

## What broke

Tatum's Sui JSON-RPC endpoint returns 404, and its gRPC endpoint speaks native gRPC, which the fetch-based gRPC-web client in `@mysten/sui` can't read from Node or a Worker. Everything Sui goes through Tatum's Sui GraphQL endpoint instead, with the same client API. Its `getChainIdentifier` helper fails there, so the chain id comes from a raw `{ chainIdentifier }` query.

Tatum's Prediction Market history returned no candles for resolved Polymarket markets with the default `candlesticks` source. `source=midpoint` has every minute.

Tatum's `status=active` market list also returns markets whose close time has passed, so the bot finds live markets on Gamma and then rules through Tatum.

The Tatum free plan allows 3 requests a second and 100K credits a month. Calls are throttled, and Prediction Market responses are cached at the edge.

Cloudflare's free Workers plan allows 50 subrequests per request. Scanning a market's lifetime of Polygon logs doesn't fit, so the lineage is read locally and posted to the Worker, and block lookups use interpolation search instead of a 27-call binary search.

Gamma refuses offsets past about 2,000 and drops connections under load. The crawler splits busy days into smaller windows and resumes where it stopped.

An early version of the grader graded two rulings I issued in November on the long-resolved MSTR market and wrote its outcome back as a precedent twice. Grading now only counts rulings issued before a market closes, replay rulings are labelled and never priced, and a market becomes case law once. Walrus is append-only, so those two grade memories and the duplicate precedent are still on mainnet. The eval recalls only the seeded pool, so they don't touch the numbers.

## Run it

```
npm install
cp .env.example .env            # fill in the keys
npx tsx scripts/create_accounts.ts 3     # MemWal accounts + delegate keys, gas sponsored by the relayer
npx tsx scripts/smoke.ts all              # Tatum PM, Sui, Polygon, MemWal, x402
npx tsx eval/crawl_gamma.ts 2024-01-01 2026-11-01 3
npx tsx eval/build_dataset.ts 100
npx tsx scripts/seed_precedents.ts 401 10
npx tsx eval/run_baseline.ts rules 3 200
npx tsx eval/run_fineprint.ts patterns 3 200
npx tsx eval/report.ts
npx wrangler d1 migrations apply fineprint --remote && npx wrangler deploy
npx tsx src/bot/buyer.ts replay-mstr      # the 1 June moment, paid
```

## Mainnet and testnet IDs

<!-- ids:start -->
Pending.
<!-- ids:end -->
