# Smoke tests

Run: `npx tsx scripts/smoke.ts all` at 2026-11-09T14:13:23.698Z

## pm
Tatum PM `/markets/0x3733a1b647…`: "MicroStrategy sells any Bitcoin by May 31, 2026?" status=resolved resolution={"outcome":"NO","resolvedAt":"2026-07-01T00:00:00.000Z","txHash":null,"source":"UMA"}
Rules (first 200 chars): This market will resolve to "Yes" if MicroStrategy sells any of its Bitcoin by 11:59 PM ET on the date specified in the title. Otherwise, this market will resolve to "No".  The primary resolution sour
History 1 June 2026 (1m candles, 390): 11:00=0.1255 12:20=0.812 16:59=0.532 17:01=0.006
**PASS**

## sui
Tatum Sui GraphQL chainIdentifier: 4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S
Tatum Sui GraphQL object(MemWal registry 0x8bf82c9e…): version 1074813391, type 0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5::account::AccountRegistry
Tatum Sui GraphQL transaction(9Y8pzZEM7XcLo8pQFdRrUVSAX4E8cpmA97ByTxNtf5RU): success=true
Tatum Sui JSON-RPC sui_getChainIdentifier: HTTP 429 {"statusCode": 429, "message": "You have exceeded your limit of 3 requests per second. To increase this limit, upgrade to a Paid plan with 200 requests per seco
**PASS**

## polygon
Blocks 5 May → 5 June 2026: 86409578 → 87941743
BulletinBoard AncillaryDataUpdated for questionID 0x0382b71b4d…: 2 update(s)
- block 87761982 tx 0xbd0bf99bdb0488e772c8c90abf18913871d449d19322bc05839fd43ceaa6ffbd owner 0xf43d55f3a8b7484ed4b6931f93cb6f9ef5dd369d: "We’re aware of the dispute on this market. If a clarification is to be issued, it will be at 1:00 PM ET on June 1. If no statement is issued at that time, then there will be no clarification by the Polymarket team. The orderbook will be cleared at 1:00 PM ET, regardless of whether a clarification is"
- block 87767711 tx 0x739e6133c031f5d1cdb4eb998fd3b037ee6fbc6829479a51154f4072c70c4239 owner 0xf43d55f3a8b7484ed4b6931f93cb6f9ef5dd369d: "No information from MSTR, on-chain data, or consensus of credible reporting confirmed that MicroStrategy sold Bitcoin within the market's timeframe.   Confirmation achieved outside of the market's time frame does not qualify."
DisputePrice events 1–4 June 2026: 40 total, 2 for the MSTR question
- block 87741382 tx 0xc5e63a7828b193232c33cb93db44b2f1c05f017c4bfe16d54078be560ae25aab disputer 0x795618f3dcd72b4093a2d6a6b22cb7b17351926e
- block 87742777 tx 0xbcbd0d858e43a073bd64b334577c088b72e6dde8b1a9184de658108b0d2a377e disputer 0xd7f6ebdf0235f587154e2d7d38f9d80568494993
The 1 June clarification IS on-chain.
**PASS**

## memwal
PRECEDENTS (0x3d46b963…): remember → blob KqZ1gncBmj1WhpVckr1Cd3UtZ9e6sm4Z1_PGt4FtjcU in 20017 ms; recall found it: true after 3212 ms
COURT (0x948ae9d2…): remember → blob eyAgAMTWF3Fmm3_XwHFndhf6AD8QDdeK9FtcyrsngGY in 27136 ms; recall found it: true after 1867 ms
USER (0xe5510c4e…): remember → blob 8BX_1kTDcDIvrHpHKqfbQY_AkIGsOaRwjuAV2lpKUJc in 30767 ms; recall found it: true after 2358 ms
**PASS**

## x402
Payment network: sui:testnet
Bot 0x5fcba73f1c5f8d4698cea37af89d975d3891696214365d89bed6019dc9575b65 USDC: {"total":19.98,"coins":0,"address":19.98}
402 → paid 0.023 USDC, digest 5E5z36iY5keQiaFHLcWCw3QBxQF6wxxsNM1ksD4wrgpV (https://suiscan.xyz/testnet/tx/5E5z36iY5keQiaFHLcWCw3QBxQF6wxxsNM1ksD4wrgpV)
Ruling: HIGH p=0.72 cites=xPylFoZWSadMKzBSaPOlSbsX11Vu0s8NVzpbxLVMW0s,BBc4R4zsfe1ny5cM5s0NuSGyixdyzByysRvRVjAyvIw,4dJmrFJviIJDpu5kmY9Y3zVDVTxhjJWvd-hODNGnPGc,phm8b-3jHO1tVhTt-UpxYh1qtXuzbH_IG1CAhy8i4SQ,CxUGIfMua8gZXrl3M0PaRCY8brCoCZviegFb5FyEsgw
Server-side re-check of the digest through Tatum Sui GraphQL (testnet): true
Timings: challenge 4352 ms, pay+ruling 18974 ms
**PASS**

## Summary
- pm: PASS
- sui: PASS
- polygon: PASS
- memwal: PASS
- x402: PASS

Tatum call latencies in this run:
```
[
 {
  "call": "tatum.pm /markets/{id}",
  "n": 1,
  "p50": 412,
  "p95": 412
 },
 {
  "call": "tatum.pm /markets/{id}/history",
  "n": 1,
  "p50": 669,
  "p95": 669
 },
 {
  "call": "tatum.polygon eth_blockNumber",
  "n": 4,
  "p50": 208,
  "p95": 415
 },
 {
  "call": "tatum.polygon eth_getBlockByNumber",
  "n": 107,
  "p50": 403,
  "p95": 584
 },
 {
  "call": "tatum.polygon eth_getLogs",
  "n": 540,
  "p50": 400,
  "p95": 556
 },
 {
  "call": "tatum.sui GetTransaction",
  "n": 1,
  "p50": 446,
  "p95": 446
 }
]
```
