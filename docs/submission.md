# Submission form: Fine Print

Every field below is ready to paste. Numbers come from `eval/results/` (see `eval/REPORT.md` for the command behind each one).

## Basics

Project name: Fine Print

Track: Markets & Sports Prediction (also entering Best Walrus Memory and Best Use of Agent Payments)

One-line pitch: Fine Print checks a market's rules against past rulings before you buy.

Demo URL: https://fineprint.prashantthakur.dev

Repository: https://github.com/Prashant-thakur77/FinePrint

Video: (paste the YouTube link after uploading `docs/video/`)

Blog post: (paste the dev.to link after publishing `docs/blog.md`)

## IDs

Tatum account ID: `6af1ca5c059c9eaaf7a6e334`

Sui address (server wallet, receives ruling payments and sends refunds): `0xaca6dfb9f0c6b37e5cd51a82b4261cb1d2ed2087bd0c137c31f8c794e40eea06`

Account ID (Sui), the MemWal account on Sui mainnet. If the form takes one, use PRECEDENTS: `0x3d46b9637ee3dfc2d297bec29b1bb7d1add07d0c98bd9bea02badabfd5c804b4`

All three MemWal accounts (Sui mainnet):
- PRECEDENTS `0x3d46b9637ee3dfc2d297bec29b1bb7d1add07d0c98bd9bea02badabfd5c804b4`
- COURT `0x948ae9d2bf8f29ac62cd89bd90307db8f4d7cc5c4323aed20862eb09e18cf658`
- USER `0xe5510c4e27315d3c0f10337bf6dd0495d5c33eca4215e8ebaa128420a83fb4ee`

MEMWAL_AGENT_ID (delegate public key). If the form takes one, use the PRECEDENTS key: `48f5418a00a044794707504125eaea08fb4e6c8eaa2c0848156bb9baa5c0ed18`

All delegate public keys:
- PRECEDENTS `48f5418a00a044794707504125eaea08fb4e6c8eaa2c0848156bb9baa5c0ed18`, `9b34536661d927167883ad10c8800cea02566eac392aa962829bdfe4d18a0bc4`, `f588d4e9fd5dc1aa087da0d1bf4d50b73e4c036cb6ba94b4f947f5e74e6c9005`
- COURT `6c7aaf87db42274f050995a05c932a8404c1b91cb0e11947217fcd419a21322d`, `ee589306f6053e86ab0c74e15c9c8348b4416d8fa4044ab46a40fbb4567152ec`, `6d7a3e8e796a12fdb26f51a90f472addfb4fd4025179cda464a45dbfcd22fa85`
- USER `a98f2399e5436495df5d4d533966cffb6ac13b2d27e0fcd78eda8a8a81f63ad7`, `5d62fe76d952081ecdc6d6d3de8a8cc444d5803598247e147aa5df0a9e6aeda9`, `047b1f284ae7bc293b0e50ea2cf0884c7643f5fa03ffeda0cde4c90040b6bfef`

## Description (long)

On 1 June 2026 a Polymarket trader bought YES on "MicroStrategy sells any Bitcoin by May 31, 2026?" after Strategy's 8-K showed bitcoin sold in late May. YES went from 11c to 81c. At 17:00 UTC the market's owner posted a clarification on Polygon ("confirmation achieved outside of the market's time frame does not qualify") and YES fell from 53c to 0.6c in two minutes. The same wording had already been disputed twice on a 2025 market, which resolved NO. Nobody showed him that.

Fine Print is the check that would have. You give it a market. It reads the rules and price history through Tatum's Prediction Market API, recalls the closest past markets from Walrus Memory on Sui mainnet, and rules HIGH, MED or LOW dispute risk, citing the Walrus blob of every precedent it used. Replayed as of 12:20 UTC on 1 June, using only markets that had closed by then, it rules HIGH and cites the 2025 market.

Bots can buy the same ruling for 0.02 USDC over x402. Every ruling is sealed as a memory before the market resolves, graded when it does, and a wrong LOW ruling is refunded. The price per wording pattern follows the court's graded accuracy. Rule versions are rebuilt from the UMA adapter's bulletin board on Polygon (read through Tatum), so the chart shows which version of the rules you bought under.

Walrus Memory holds 401 seeded precedents and 10 learned wording patterns across three mainnet accounts, plus every ruling, grade and rule version since. Across 159,502 markets that closed before 2026, 0.47% were disputed. Markets with the MSTR wording pattern were disputed 3.5% of the time.

We published the weak spots too. On 200 unseen 2026 markets, half of them disputed, broad precedent recall did not beat rule text alone (accuracy 0.510 rule text, 0.492 Fine Print), because similar-looking markets are mostly the same template, not the same risk. The lift shows up where the wording itself is the risk: on the 12 test markets with the MSTR pattern, accuracy went from 0.417 to 0.667 with precedents. That's a small sample and the report says so. Payments run on Sui testnet because I chose not to spend money on this entry; memory is on mainnet.

## Description (short, under 300 characters)

Fine Print checks a prediction market's rules against past rulings before you buy. It recalls precedents from Walrus Memory on Sui mainnet, reads rules, prices and on-chain clarifications through Tatum, and sells cited, refundable rulings to bots over x402.

## How we used Walrus

Walrus Memory is where the court's knowledge lives: three MemWal accounts on Sui mainnet (precedents and patterns, rulings and grades, rule versions), created with gas sponsored by the relayer. Every ruling cites blob IDs, every ruling is sealed before its outcome, and resolved markets are written back as new precedents. The leakage guard filters recalled precedents by the close date stored in each memory's text.

## How we used Tatum

The Prediction Market API gives rules, outcomes and minute price history (the demo chart). The Polygon RPC reads the UMA adapters' bulletin board (`AncillaryDataUpdated`), which is how we found the 17:00:16 UTC clarification on-chain, and the Optimistic Oracle's `DisputePrice` events. The Sui GraphQL gateway settles and re-checks every x402 payment and reads balances and the chain id.

## Feedback on Walrus Memory

The relayer's sponsored transactions (`/sponsor`, `/sponsor/execute`) made account setup free, but they aren't in the docs; we found them by reading the playground's code. A short page on them would help. Writes took 21 to 28 seconds to return a blob ID in our smoke test, and recall found the new memory less than 3 seconds after that. Recall is semantic only, so filters such as "closed before date X" have to be applied after recall, which means asking for more results than you need. A metadata filter on recall would remove that step. `listMemories` was handy for counting what we wrote.

## Feedback on Tatum

The Prediction Market API was easy to use and the `midpoint` history source had full minute data for resolved Polymarket markets, but the default `candlesticks` source returned no candles for them, which took a while to spot. `status=active` also returned markets whose close time had passed. For Sui, the JSON-RPC endpoint returned 404 and the gRPC endpoint speaks native gRPC, which the fetch-based gRPC-web client in `@mysten/sui` can't use from Node or a Worker. The GraphQL endpoint worked well. The Polygon RPC handled our log scans fine. The free plan's 3 requests a second meant throttling everything.

## Feedback on Tatum AI Builder

(Only if you used it. Fine Print did not use AI Builder, so leave this blank or say so.)
