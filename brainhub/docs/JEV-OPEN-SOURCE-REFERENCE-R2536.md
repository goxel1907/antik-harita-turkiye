# JEV Open-Source Engineering Reference — R2536

Status: **READ_ONLY_REFERENCE_REGISTRY**.

Purpose: give JEV's verified research desk additional public engineering references for exchange APIs, market microstructure, backtesting, indicators, event-driven execution, portfolio/risk analytics, and trading-system architecture.

These repositories are **not market evidence**, do not vote LONG/SHORT, do not bypass JEV, and are never executed or vendored automatically. Repository popularity is not evidence of correctness. Source text must still pass the R2536 allowlist, relevance check, fetched-source grounding, and JEV `ACCEPT_REFERENCE` review before a knowledge note can persist.

## Curated repositories

| Repository | License | Read-only reference role |
| --- | --- | --- |
| ccxt/ccxt | MIT | Exchange API / market-data / order semantics |
| hummingbot/hummingbot | Apache-2.0 | Order-book, connector and execution architecture |
| jesse-ai/jesse | MIT | Strategy, risk and backtesting architecture |
| QuantConnect/Lean | Apache-2.0 | Event-driven execution, portfolio and backtesting architecture |
| TA-Lib/ta-lib-python | BSD-2-Clause | Indicator implementation/reference |
| nautechsystems/nautilus_trader | LGPL-3.0 | Event-driven trading/execution architecture |
| freqtrade/freqtrade | GPL-3.0 | Crypto-bot, risk and backtesting reference only |
| mementum/backtrader | GPL-3.0 | Backtesting/strategy reference only |
| pmorissette/bt | MIT | Portfolio/backtesting reference |
| ranaroussi/quantstats | Apache-2.0 | Performance and risk analytics reference |

## License discipline

No repository code is copied automatically into BrainHub. GPL/LGPL/AGPL-style licensing must never be bypassed by copying implementation into proprietary or differently licensed code. R2536 uses repository pages only as read-only research sources when the URL belongs to the curated registry.

## Research authority

Primary trading facts should prefer exchange/regulator/market-education sources such as Binance, CME Group, CFTC and TradingView documentation. Curated GitHub repositories are secondary engineering references, particularly for software behavior, indicator implementation, execution abstractions and backtesting architecture.

Every persisted dynamic knowledge entry remains:
- `VERIFIED_REFERENCE`
- `selfModify=false`
- `autoPromotionToRules=false`
- `executionAuthority=false`

JEV remains the strategic decision owner; hard safety remains deterministic.
