# Futures15m Alarm PRO — Trade Brain Product Contract

This file is the persistent product contract for the Trade Brain work. It exists so future implementation does not depend on chat memory alone.

## Preserve existing behavior

- Keep the current saved ChatGPT `/c/...` workflow as a fallback: prompt to clipboard, charts to Gallery, same saved conversation opened app-first with browser fallback.
- Keep single and batch analysis behavior; batch remains 2–8 coins.
- Keep plan-only output contract for the existing ChatGPT analysis flow.
- Preserve saved plans, signals, open-position metadata, trade cards and update/signing continuity.
- Do not silently remove existing manual controls.

## In-app agent and shared brain

- The in-app Trade Agent must read the same BrainContext/MarketSnapshot used by scanners and trade logic, not operate as a detached chatbot.
- It must be able to discuss all saved plans, signals, open positions, analysis metadata, leader candidates, market regime, and Brain history.
- It must answer live questions such as: strongest current futures candidates, why a trade is open/waiting, scenario impact of BTC/ETH moves, news impact, and why a candidate was rejected.
- 9Router is the free-first model router. Never silently fall back to a paid model. Free provider availability is not assumed to be unlimited.
- PC is an optional 24/7 Brain Hub/Turbo worker; mobile must retain core scanning/control capability without the PC.
- For targeted Leader AUTO analysis, generating 9 chart PNGs is not equivalent to model chart reading. A real Vision route must receive all 9 images and return coin-specific `WHY`, `RISK_NOTE`, `WAIT_FOR`, `VISION_SUMMARY` and per-timeframe `TF_1M..TF_1D` notes; otherwise remain `REVIEW_REQUIRED`.
- Deep Vision verification must prove visual transport, not only text response: the diagnostic probe must attach all 9 timeframe charts and require the model to read a hidden per-image visual marker whose expected value is known only server-side. All 9 markers must match. Diagnostic markers are never added to normal trade-analysis images and never become market evidence; the forming candle remains context, never confirmation.
- Deterministic timeframe evidence must stay visibly separate from model/Vision interpretation. Never label RSI/BOS/FVG/pattern summaries as if the model visually read the chart.
- Kiro connected-account free quota may be used for 9TF Vision only after explicit local opt-in and only through an allowlisted Kiro Vision model set. If that quota/route is unavailable, Vision remains fail-closed unless a separate paid fallback is explicitly enabled. Free-model failure must never silently consume a paid API/provider route.

## Universe Scanner / Leader Hunter

- Scan the full eligible USDT perpetual futures universe, not only a fixed watchlist.
- The goal is not merely to display the current top gainers/losers; detect coins accelerating toward top-1/top-5 earlier.
- Maintain Rank Velocity and acceleration history, including price momentum, volume rank/acceleration, OI change, taker imbalance, L2 imbalance/spread, funding behavior, volatility expansion/compression, squeeze/crowding clues and relative strength.
- Maintain separate `ATTACK_SCORE` and `TRADE_QUALITY`. A coin may be a likely leader yet be too late/unsafe to chase.
- General market context must not be a hard veto for exceptional leader candidates. Systemic/liquidity danger may still veto.

## Timeframes and trade lifecycle

- Entry/scanning timeframes: 1m, 3m, 5m, 15m, 30m.
- Ownership/handoff timeframes are open-ended upward: 1m → 3m → 5m → 15m → 30m → 1h → 4h → 1D and later higher frames if implemented.
- A trade may begin as a scalp and be handed to a stronger higher-timeframe trend/structure/liquidity target.
- UI and agent must explicitly tell the user when a trade changes state, e.g. `SCALP • 1m`, `HANDOFF ARMED • 3m`, `5m DEVRALDI`, `RUNNER • 1h`, `4h LIQUIDITY TARGET`, `MOMENTUM ZAYIFLIYOR`.
- Handoff must never widen initial risk simply because a higher timeframe took ownership. Stops may only become safer / lock profit according to the risk engine.
- Higher-timeframe liquidity pools, structural invalidation, swing levels and trend decay can become exit-management references up through 1h/4h/1D.
- Support partial scalp profit plus a runner when appropriate.

## Global market regime

- Do not reduce market context to BTC alone.
- Track BTC, ETH, ETH/BTC relative strength, USDT dominance, TOTAL2 and TOTAL3.
- Track regime across relevant timeframes where reliable data/history exists.
- Use context as a weighted factor, not a universal hard veto for exceptional futures leaders.

## Live data / analysis domains

Use reliable available data without inventing missing values:

- OHLCV and multi-timeframe structure/trend/momentum.
- EMA/VWAP/ATR/RSI and other justified deterministic features.
- Breakout/retest, mean reversion, support/resistance, volatility compression/expansion.
- Futures funding, open interest, basis where available, long/short ratios, taker flow, order book depth/imbalance/spread, squeeze/crowding/liquidation clues where reliable.
- BTC/ETH/global regime and altcoin rotation.
- Timely news, exchange announcements, listing/delisting, unlock/project catalysts, fundamental/on-chain inputs when reliable sources are available.
- Data freshness and quality must be explicit. Missing data must not be fabricated.

## Learning / Brain memory

- Persist each candidate/trade snapshot, decision, confidence, agent disagreement and later outcome.
- Measure outcomes after useful horizons (for example 5m/15m/30m/1h/4h) and by market regime.
- Learn which setups, features, agents and timeframe-handoff patterns perform better in which regimes.
- Learning must be measurable and reversible; do not let an LLM silently rewrite hard risk rules live.
- Maintain journal/history that the user can ask the agent about.

## Live auto-trade target

The product target includes real Binance Futures execution, with user-controlled settings:

- LONG and SHORT.
- User chooses margin amount and leverage.
- User chooses maximum simultaneous positions, at minimum selectable 1–5.
- Small-timeframe opportunities from 1m–30m are eligible.
- Support scalp and momentum/runner management.
- Dynamic exit may use break-even, trailing, structural stop, momentum/order-flow decay and higher-timeframe handoff.
- Hard execution limits remain deterministic and cannot be overridden by an AI response.
- Require emergency stop, stale-data stop, connectivity failure handling, duplicate-entry/cooldown protection, max-position enforcement and a defined loss/risk ceiling.
- Exchange API secrets must never be committed to GitHub or hard-coded into the APK; no withdrawal permission.

## Product principle

`En erken doğru timeframe girişi yakalar; en güçlü doğrulanmış üst timeframe işlemi taşır.`

`Top 5'i görmek değil, Top 5 olmadan önce oluşan imzayı bulmak.`

No component may claim guaranteed profit or guaranteed prediction accuracy.