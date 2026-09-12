# v9.5.31 Research & License Notes

v9.5.31 adds market context as **soft/tie-break intelligence only**. It must not create a new hard veto or multiply correlated signals into fake confirmations.

## Reviewed and used as design references

- `ta4j/ta4j` — MIT. Useful ideas: explicit strategy/research separation, execution-cost realism, reproducible backtests.
- `nkaz001/hftbacktest` — MIT. Useful ideas: order-book/microstructure realism, queue/fill/latency awareness.
- `hummingbot/hummingbot` — Apache-2.0. Useful ideas: paper/live separation, connector resilience, order-book handling.
- `QuantConnect/Lean` — Apache-2.0. Useful ideas: separating risk/context information from the core alpha decision.

The v9.5.31 Android implementation is independent Java code; source from these repositories was not copied into the app.

## Research-only repositories, not embedded

- `facubelini/liquidation-heatmap` — repository currently has no declared license. Its public-data statistical liquidation-density concept was reviewed, but its source was not copied.
- `bendizziesmith/liqmap` — no declared license found during review; research reference only.
- `freqtrade/freqtrade` — GPLv3; used only as a reference for backtest/lookahead-analysis methodology.
- `bmoscon/cryptofeed` — AGPLv3 plus attribution term; not embedded.
- `polakowo/vectorbt` — Apache-2.0 with Commons Clause; not embedded.

## v9.5.31 decision constraints

1. `LIQ_DENS` is an estimated density model based only on public Binance USD-M market data. It is not a CoinGlass/Hyblock feed and does not know individual positions or liquidation prices.
2. Timeframes are deduplicated by family: 15m/30m/45m = INTRADAY, 1H/2H = MID, 4H and 1D are separate. Same-family overlap cannot become multiple independent votes.
3. `REGIME` is context only. Trend/range classification cannot independently open or veto a signal.
4. `BOOK_MICRO` is entry-timing / near-threshold context only. It cannot override completed-candle confirmation, structure, invalidation or R/R.
5. OI, CVD, observed liquidations and estimated liquidation density may describe the same leverage event; they must not be counted as four independent confirmations.
6. Missing or stale auxiliary data is always `PUANSIZ`, never evidence against a direction.
