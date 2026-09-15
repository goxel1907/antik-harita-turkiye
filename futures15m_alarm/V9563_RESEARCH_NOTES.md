# v9.5.63 — Hidden-gem microstructure / SMC research notes

This note documents external research references reviewed for v9.5.63. Runtime market data remains Binance USD-M public REST/WebSocket data. The Android implementation in `V9563MicrostructureFeed` is independent; third-party source code was not copied.

## MIT / safe architectural references

- `crisari666/liquidity-scanner` — Binance USDT-M `depth@100ms` + `aggTrade`, local book, wall age/persistence, hunts, heatmap, event persistence. Key lesson: a large wall can be spoofed; persistence/pull behavior matters more than one snapshot.
- `mamonet/orderbook-heatmap` — incremental L2 book, rolling/cumulative delta, imbalance, liquidity clusters and absorption. Key lesson: ingestion and rendering should be decoupled; absorption needs aggression plus failure of price to travel.
- `kotiksgame/Entropy-Liquidity-Monitor` — 0-star MIT reference using Shannon entropy + OFI on Binance WebSocket data. v9.5.63 uses normalized top-depth entropy only as a soft concentration descriptor, never a direction vote.
- `armaansg/orderbook-microstructure` — 0-star MIT reproducible OFI study. Key lessons adopted conceptually: event-time ordering, continuity across batches, no future leakage, and OFI as short-horizon micro context rather than a universal signal.
- `gopherchaan/go-spoofing-detector` — 0-star MIT reference for wall disappearance / opposing trade-burst ideas. v9.5.63 labels only `SPOOF_RISK=*ADAY`; it never claims actual spoofing or market-maker intent.
- `Khaymat/pyvsmc` — 0-star MIT SMC engine: FVG/CE/IFVG, swings, first-cross BOS/CHOCH, OB/breaker/mitigation, liquidity sweeps, premium/discount/OTE. Used as a semantic/offline oracle reference; Python is not embedded in Android.
- `joshyattridge/smart-money-concepts` — mature MIT SMC reference. Used only as a second conceptual/offline oracle; not a runtime dependency.
- `JWHaan/quant.term` — MIT research terminal with OFI/CVD/VPIN and strong provenance/gap-reporting principles. v9.5.63 follows the same broad principle: stale/gapped data becomes `PUANSIZ`, never silently fabricated.

## Research-only references (no code copied)

- `Niketion/flowdepth` — GPL-3.0; useful ideas around iceberg reload, sweep, absorption and microprice, but GPL code is intentionally not embedded.
- `Uncharted1804/microstructure-alpha-engine` — no license observed; research-only. Reinforces that OFI can be statistically real yet decay too quickly to be a direct retail execution trigger.
- `jaefit/deep-ofi` — no license observed; research-only. Useful caution that raw queue state can carry information not captured by one OFI scalar.
- `ysoliman03/crypto-divergence-engine` — no license observed; research-only architecture for reconnect/dedup/anomaly pipelines.
- `Priyaanshu-Patel/orderflow-toxicity` — no license observed; research-only.

## v9.5.63 invariants

1. Core four hard vetoes remain unchanged. L2/OFI/delta/entropy/walls/absorption/spoof-risk cannot create a fifth veto.
2. `depth@100ms`, `aggTrade`, REST snapshot, `forceOrder`, and modeled `LIQ_DENS` are distinct provenance classes. They must never be relabeled as each other.
3. A sequence gap invalidates the local L2 book and forces a reseed. Gapped/stale/warming context is `PUANSIZ`.
4. REST `BOOK_MICRO` and live L2 are the same execution/micro family. If live L2 is healthy, it supersedes REST book context; they are not two votes.
5. OFI + trade delta + imbalance + microprice + entropy + absorption are correlated microstructure views and collectively contribute at most one soft family adjustment.
6. Resting liquidity is observed, not guaranteed. Wall pull/reload can suggest spoof/iceberg risk but does not prove hidden orders, liquidation prices or market-maker intent.
7. The monitor warms L2 silently; no extra long dashboard block is added. Detailed microstructure is sent in the analysis package/prompt where ChatGPT can weigh it with structure, location, invalidation and R/R.
8. SMC oracle semantics improve consistency without inventing levels: if CE50/IFVG/OTE or another level is not supplied or unambiguously derivable from the package, it stays unknown.
