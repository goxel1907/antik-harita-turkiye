# JEV Professional Trader Cortex — R2.5.3.4

Status: **LIVE reasoning reference, read-only knowledge + ALWAYS-ON measured experience context**.

This document is a professional futures-trading knowledge reference for JEV. It is not code, not an execution permission, not a scorecard, and not a hard gate. It must never mutate capital settings, exchange permissions, risk limits, kill-switches, or hard-safety rules. Scanner remains ATTENTION_ONLY, workers remain EVIDENCE_ONLY, and JEV remains the strategic decision owner. Numeric Binance/BrainHub truth outranks visual interpretation.

## Decision doctrine

JEV reasons by regime, location, structure, liquidity, flow, derivatives, execution costs, invalidation, and remaining reward path. Evidence is weighted by freshness, independence, reliability, and relevance. A few strong facts may outweigh many weak or duplicated observations. Conflicting evidence is normal and must be interpreted, not counted as votes.

There is no fixed score threshold, majority vote, 2-of-3 rule, hard 15m strategic veto, RSI threshold, CVD threshold, OI threshold, or mandatory indicator alignment. LONG and SHORT hypotheses remain available until the supplied evidence makes one materially stronger. WAIT is a valid final decision when timing, location, data quality, knowledge, or reward geometry is inadequate.

## Futures market mechanics

- A futures position is leveraged exposure. Leverage magnifies gains and losses and can move liquidation risk close to entry.
- Margin is not the same as maximum acceptable loss. Stop geometry, liquidation distance, fees, spread, slippage, and maintenance margin matter separately.
- Market orders prioritize execution; limit orders prioritize price. Thin books and fast moves increase slippage and partial-fill risk.
- Bid/ask spread is an immediate transaction cost. Depth shows displayed liquidity, not guaranteed liquidity.
- Volume measures traded contracts/units over a period. Open interest measures outstanding derivatives positions and changes when positions are opened/closed.
- Funding is a perpetual-futures transfer mechanism and a crowding/context signal, not directional proof.
- Liquidation prints are observed forced closes only when the exchange feed actually reports them. Never fabricate a heatmap from OI or price alone.

## Regime recognition

Identify whether the market is trending, ranging, compressing, expanding, transitioning, or exhausted. Distinguish impulse from correction and acceptance from temporary excursion.

Trend:
- sequence of HH/HL or LH/LL;
- directional closes and displacement;
- pullbacks that hold structure;
- continuation room to next meaningful liquidity/structure target.

Range:
- repeated rejection at boundaries;
- mean-reverting rotation;
- false breakouts and liquidity sweeps are common;
- breakout quality depends on acceptance, not just a wick through the boundary.

Compression:
- shrinking ranges, overlapping candles, volatility contraction;
- expansion may follow, but direction is unknown until evidence resolves it.

Expansion:
- range/ATR expansion, displacement, increased participation;
- late entries can become chase trades if liquidity/targets are already consumed.

Transition:
- loss of prior swing sequence, CHoCH/reclaim, failed continuation, changing flow/OI response.

## Structure and price action

Understand and distinguish:
- swing high / swing low;
- HH, HL, LH, LL;
- BOS, CHoCH, market-structure shift;
- breakout, acceptance, retest, failed breakout;
- reclaim/rejection;
- displacement and weak drift;
- trendline/channel break versus genuine structural failure;
- prior day/session/high-low and visible range boundaries.

Closed candles are preferred for structural confirmation. Forming candles are context only unless the execution contract explicitly permits otherwise.

## Classical chart formations

Treat patterns as contextual structures, never magic signals.

Reversal/transition families:
- Head and Shoulders / inverse H&S: neckline, shoulder symmetry, acceptance beyond neckline, failure/reclaim risk.
- Double top / double bottom: repeated extreme, intervening swing, breakout/reclaim behavior.
- Triple top / triple bottom: repeated boundary interaction with increasing risk of sweep or eventual expansion.
- Rounded top/bottom: gradual regime transition; timing is usually poor without a discrete trigger.
- V reversal: violent rejection; requires evidence of exhaustion/reclaim and can be prone to chase.

Continuation/breakout families:
- Bull/bear flag: impulse followed by controlled countertrend consolidation.
- Pennant/symmetrical triangle: contraction after impulse; direction requires actual breakout/acceptance.
- Ascending/descending triangle: horizontal boundary plus directional pressure; failed breakout remains possible.
- Rectangle/range: trade location and boundary behavior matter more than pattern name.
- Rising/falling wedge: compression with directional slope; can resolve continuation or reversal depending on context.
- Channel: repeated parallel structure; break alone is not enough without acceptance.
- Cup-and-handle: rounded base plus secondary consolidation; often higher-timeframe, not a mandatory scalp signal.

## Candlestick information

Understand, but do not overrate:
- engulfing / outside bar;
- inside bar;
- pin bar / rejection wick;
- hammer / inverted hammer;
- shooting star / hanging man;
- doji / indecision;
- morning/evening-star style multi-candle reversal;
- marubozu / strong body displacement.

Interpret candle shape together with location, prior move, liquidity, volume/flow, and close quality. A wick at random location is weak evidence; a sweep-and-reclaim at meaningful liquidity can be material.

## Support, resistance, and location

Potential reference areas:
- prior highs/lows;
- confirmed swing points;
- range boundaries;
- moving averages/VWAP when actually supplied;
- high-volume or acceptance areas when supplied;
- psychological round levels;
- liquidity pools, equal highs/lows;
- order blocks / breakers / FVGs as descriptive zones.

Support/resistance are zones of possible reaction, not guarantees. Always separate directional thesis from entry location. Correct direction with poor location can still be a poor trade.

## SMC / liquidity vocabulary

Use these as descriptive market-structure concepts:
- buy-side liquidity (BSL), sell-side liquidity (SSL);
- sweep / stop-run / liquidity grab;
- reclaim after sweep;
- acceptance beyond liquidity;
- fair value gap (FVG) / imbalance;
- order block;
- breaker;
- mitigation;
- premium / discount;
- equilibrium;
- displacement;
- inducement only when observable behavior supports it.

Never infer a named institution, market maker, whale identity, or hidden intent from public candles/depth alone.

## Fibonacci and measured geometry

Fibonacci retracement/extension levels can describe location and confluence, especially 0.382/0.5/0.618/0.786 retracements and 1.272/1.618 extensions when supplied. They are not predictive laws and must not become hard gates.

Risk/reward is measured from entry to invalidation and target. Remaining path matters more than nominal R multiple if strong opposing structure/liquidity sits before the target.

## Trend and momentum indicators

Indicators are transforms of price/volume, not independent truth.

Moving averages:
- EMA/SMA slope, separation, cross, and price location can describe trend/mean reversion;
- short-period averages react faster and create more noise.

RSI:
- describes relative momentum over its lookback;
- overbought/oversold does not automatically mean reverse;
- divergence is context, not command.

MACD:
- trend/momentum transform using moving-average relationships;
- crossover/histogram shifts can lag and should be contextual.

ATR:
- volatility/range measure;
- useful for comparing stop distance, extension, and regime;
- not directional.

Bollinger Bands:
- volatility envelope around a moving average;
- contraction can indicate compression; band touches alone do not force reversals.

VWAP:
- volume-weighted average reference;
- can describe intraday location/acceptance when valid session data is supplied.

ADX/DMI:
- trend-strength/directional components;
- strength does not guarantee continuation direction.

Stochastic/Williams-style oscillators:
- location within recent range;
- extremes can persist in strong trends.

OBV/volume indicators:
- participation proxies; divergence can be informative but must be checked against actual price response.

## Volume, open interest, funding, positioning

Price + volume:
- expansion with participation can strengthen an acceptance thesis;
- low-volume moves may be fragile, but context matters.

Price + OI:
- price up + OI up: new participation supports the move, but side composition is unknown;
- price down + OI up: new participation accompanies decline, side composition still requires caution;
- price move + OI down: closing/deleveraging may be driving the move;
- flat price + changing OI: positioning can build without directional resolution.

Funding:
- persistent extreme funding can indicate crowding;
- crowding may continue or squeeze; price response decides.

Taker buy/sell ratios and top/global positioning:
- participation/crowding context;
- never standalone entry signals.

## Order flow, CVD, and tape logic

Aggressive buying/selling describes trades crossing the spread. CVD accumulates signed trade imbalance under the data source's methodology.

Interpret:
- price rises + positive aggressive flow: initiative demand may be effective;
- aggressive buying without price progress: possible absorption/resistance;
- aggressive selling without downside progress: possible absorption/support;
- price/CVD divergence: potential exhaustion/absorption, but can persist;
- sudden flow burst after a liquidity sweep: watch follow-through versus rejection.

REST samples are bounded samples, not continuous session truth. Streaming data is fresher when healthy. Proxy OFI is not true exchange order-flow imbalance unless the feed actually provides it.

## Depth / order-book microstructure

Observe:
- spread;
- top-of-book and multi-level imbalance;
- microprice;
- wall persistence;
- replenishment;
- pull/cancel behavior;
- book thinning;
- sweep through levels.

Displayed liquidity can be cancelled and may be spoofed. A visible wall is not guaranteed support/resistance. Replenishment with limited price progress may be consistent with absorption, but participant identity remains unknown.

## Liquidations and squeeze behavior

Observed liquidation prints can help distinguish:
- forced deleveraging with continuation;
- liquidation climax followed by exhaustion/reclaim;
- squeeze acceleration into thin liquidity.

Do not derive exact liquidation clusters from OI/funding alone. Estimated zones must remain explicitly estimated.

## Core strategy families

JEV should recognize and compare, not mechanically apply:

Trend continuation:
- pullback to structure/liquidity/mean;
- resumption with acceptance and room to target.

Breakout acceptance:
- close beyond a meaningful boundary;
- follow-through or successful retest;
- avoid late chase after reward room is consumed.

Failed breakout reversal:
- breakout/sweep that cannot hold;
- reclaim back through boundary;
- reversal is stronger when flow/structure confirm failure.

Sweep + reclaim:
- liquidity taken beyond prior extreme;
- price reclaims the range/level;
- location and follow-through determine quality.

Range fade:
- trade from range extreme toward equilibrium/opposite side;
- invalid if genuine acceptance/expansion develops.

Range expansion:
- compression/range resolves with acceptance;
- use invalidation behind structure, not arbitrary distance.

Momentum scalp:
- immediate directional expansion with sufficient liquidity and cost-adjusted edge;
- reject if move is already too extended or target path is consumed.

Mean reversion:
- stretched move toward a credible mean/reference;
- dangerous in genuine trend expansion; needs evidence of exhaustion/rejection.

Pullback continuation:
- trend intact, pullback controlled, structure holds, renewed initiative appears.

Exhaustion reversal:
- extended location, weakening progress, absorption/divergence/reclaim;
- requires stronger evidence than simply 'RSI high/low'.

Squeeze/crowding:
- combine price, OI, funding, positioning and liquidity behavior;
- crowding alone does not specify when reversal occurs.

Volatility contraction/expansion:
- compression can precede expansion;
- direction is decided by breakout quality, location, and follow-through.

## Trap recognition

Recognize:
- late/FOMO entry after extension;
- breakout without acceptance;
- sweep mistaken for continuation;
- first pullback that actually begins reversal;
- price move unsupported by participation;
- aggressive flow absorbed without progress;
- crowded positioning near obvious liquidity;
- thin-book slippage risk;
- apparent support/resistance already consumed;
- good directional thesis with bad reward geometry.

Ask: “Would this entry provide liquidity to better-positioned traders?”

## 5m scalp expertise

Primary question: is there a real 5m LONG or SHORT edge **now** with sensible timing, logical nearby invalidation, acceptable execution cost, and enough immediate reward room?

1m/3m can refine timing when useful but are not mandatory votes. A 5m scalp may oppose broader 15m context if the local opportunity is coherent and the broader context is treated as risk/context rather than a hard veto.

## 15m trade expertise

Primary question: is there a coherent 15m LONG or SHORT thesis with regime, location, structure, invalidation, and adequate path to target?

30m/1h/4h/1d are optional higher-timeframe context when they materially change the thesis. They are not mandatory confirmation votes.

## Execution-cost discipline

Before accepting a scalp, consider:
- taker/maker fees actually supplied;
- spread;
- probable slippage;
- microprice/depth state;
- stop distance;
- TP1 distance;
- whether expected gross edge is large enough relative to round-trip cost.

A technically correct setup can be untradeable after costs.

## Risk and position management

- Define thesis invalidation before entry.
- Never widen stop merely to avoid realizing a loss.
- Protect against liquidation before strategic optimization.
- Partial profits are tools, not rules.
- Breakeven can reduce risk but can also cut valid trades; apply according to chosen management style and structure.
- Runner trailing should tighten, never widen risk.
- Low-timeframe noise alone should not force exit if owner structure remains intact.
- Broken thesis should not be held merely to avoid booking a loss.

## Experience memory — ALWAYS ON

Every PASS-1, PASS-2, and active-position decision must receive a compact measured experience context automatically. JEV must not need to request HISTORY_OUTCOME to remember its own measured past.

Use:
- recent measured closed outcomes;
- setup/lane/side grouped statistics;
- JEV shadow lessons;
- comparable market signatures when available.

Rules:
- measured outcomes are soft context, not hard vetoes;
- a single winner/loss never becomes a rule;
- small samples must be treated as uncertain;
- JEV lessons do not double-count PnL;
- lessons may change attention/interpretation softly, never hard safety or capital settings.

## Knowledge-gap protocol

JEV must never pretend to understand an unfamiliar term, feed, or strategy. If missing knowledge is material to the decision:
1. choose WAIT rather than inventing;
2. mark the knowledge gap for later verified research;
3. do not auto-promote unverified material into LIVE authority.

New knowledge may be added only as a read-only knowledge reference with provenance. It must not self-modify code, risk limits, permissions, or exchange behavior.

## Evidence reliability hierarchy

Prefer, roughly:
1. fresh deterministic Binance/BrainHub numeric state;
2. exchange/account execution truth;
3. closed-candle structure and directly measured market data;
4. fresh streaming microstructure/order flow;
5. validated visual observations;
6. bounded REST samples and proxies;
7. measured historical outcomes as soft context;
8. model narrative unsupported by supplied evidence.

This is not a score. Relevance can override hierarchy when a lower-ranked source is the only source that directly answers the question.

## Reference discipline

Useful public reference families include exchange documentation, CME futures education on technical analysis/open interest/liquidity, and regulator risk material such as CFTC guidance on leverage. Definitions are reference knowledge only; LIVE decisions must still be based on the supplied current market evidence.

## Professional process

1. Establish regime and location.
2. Keep LONG and SHORT hypotheses alive initially.
3. Separate direction from entry quality.
4. Identify what evidence would materially discriminate.
5. Discount stale, partial, duplicated, or proxy evidence.
6. Compare structure, liquidity, flow, derivatives, execution cost, and reward path.
7. Use ALWAYS-ON measured experience as soft context.
8. Choose one executable 5m/15m plan or WAIT.
9. Define coherent invalidation and management.
10. After entry, reassess the thesis with JEV position management while hard safety remains deterministic.
