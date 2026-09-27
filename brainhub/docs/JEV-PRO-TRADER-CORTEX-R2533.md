# JEV Professional Trader Cortex — R2.5.3.3

Status: **knowledge reference / SHADOW learning curriculum**.  
Authority invariants stay unchanged: scanner = ATTENTION_ONLY, workers = EVIDENCE_ONLY, JEV owns strategic reasoning, self-modify=false, auto-promotion=false.

## Core doctrine

JEV must reason like an experienced futures trader and scalper, not like a checklist engine. Evidence is weighted by context, freshness, independence and relevance. A few strong observations may outweigh many weak or duplicated observations. Conflicting evidence is informative and is not automatically a veto. LONG and SHORT hypotheses should both remain available until the market evidence makes one superior. WAIT is valid when the opportunity is unclear, extended, poorly located, weakly timed or offers poor reward geometry.

No fixed score, majority vote, 2-of-3 rule, hard 15m veto, RSI threshold, CVD threshold, OI threshold, or mandatory indicator alignment is part of this knowledge reference.

## Market regime

- Identify trend, range, compression, expansion and transition.
- Distinguish impulsive movement from corrective movement.
- Judge continuation versus exhaustion and whether volatility is expanding or contracting.
- Treat regime as context, not a trade permission rule.
- Recognize when a pattern that works in a trend may fail inside a range or late expansion.

## Location

- Read price relative to recent dealing range, swing extremes, equilibrium, premium/discount and visible liquidity.
- Separate directional correctness from entry quality.
- Recognize chase risk after extension or after nearby liquidity has already been consumed.
- Ask whether the entry has enough remaining path to the next meaningful target.

## Structure

- Read HH/HL/LH/LL sequences and confirmed swing points.
- Interpret BOS, CHoCH, displacement, reclaim/rejection, failed breakout and acceptance.
- Prefer closed-candle facts for structural confirmation; forming candles remain context only.
- Understand that 5m can offer a scalp against a broader 15m context without requiring a permanent higher-timeframe reversal.

## Liquidity

- Map buy-side and sell-side liquidity, equal highs/lows, prior extremes and obvious stop locations.
- Distinguish sweep/stop-run from acceptance beyond liquidity.
- Evaluate sweep + reclaim, sweep + continuation, liquidity vacuum and next liquidity target.
- Never infer hidden participant identity or intent from liquidity behavior alone.

## Price action / SMC vocabulary

- Use FVG/imbalance, order block, breaker, mitigation, displacement candle, engulfing/outside/rejection and compression-to-expansion as descriptive context.
- Pattern labels are not magic signals. Their value depends on regime, location, freshness, structure and available reward room.
- Prefer a coherent invalidation thesis over pattern naming.

## Order flow

- Read aggressive buying/selling, CVD direction, price/CVD disagreement, absorption, exhaustion and initiative versus responsive flow.
- Treat divergence as evidence, not a command.
- Ask whether aggressive flow actually moves price or is being absorbed.
- Streaming data is more immediate than bounded REST samples. REST aggTrades fallback is a recent sample, not continuous session CVD.

## Depth / microstructure

- Read spread, bid/ask imbalance, microprice, visible wall persistence, wall pull and replenishment.
- Replenishment with poor price progress may be consistent with absorption.
- Visible depth can be cancelled or spoofed; never assert participant identity or intent.
- participantIdentity remains NOT_IDENTIFIED and participantIntent remains NOT_ASSERTED unless independently known from authoritative data.

## Derivatives

- Interpret price jointly with open interest.
- Rising price + rising OI, falling price + rising OI, price movement with falling OI and flat OI describe different participation regimes.
- Use funding, taker buy/sell and top/global positioning as crowding and participation context rather than standalone signals.
- Crowding may fuel continuation or squeeze; price response and liquidity behavior decide which interpretation matters.

## Liquidations

- Only exchange forceOrder prints are observed liquidation events.
- Estimated liquidation zones/heatmaps remain explicitly estimated.
- After observed liquidations, judge follow-through versus exhaustion/reclaim.
- Never fabricate liquidation clusters from OI, funding or price action.

## 5m scalp expertise

- Primary question: is there a real 5m LONG or SHORT edge now with sensible timing, nearby logical invalidation and enough immediate reward room?
- Common archetypes: sweep + reclaim, failed breakout reversal, breakout acceptance/continuation, compression expansion, pullback continuation, exhaustion reversal.
- 1m/3m may refine timing when useful but are not mandatory votes.
- Account for spread, slippage, extension and the risk of becoming exit liquidity.

## 15m trade expertise

- Primary question: is there a coherent 15m LONG or SHORT thesis with regime, location, structure, invalidation and adequate reward path?
- Common archetypes: trend continuation, range expansion, reclaim/rejection, failed breakout, liquidity reversal and structural transition.
- 30m/1h/4h/1d are optional context when they materially change the thesis, not mandatory confirmation votes.

## Trap recognition

- Recognize late/FOMO entry after extension.
- Recognize breakout without acceptance, sweep that immediately reclaims, unsupported price/CVD or price/OI movement, crowded squeeze risk and exhaustion after liquidity events.
- Ask whether the proposed entry is likely to provide liquidity to better-positioned traders.
- A trap hypothesis requires observable footprints and must not be attributed to a named market maker without evidence.

## Risk and position management

- Separate thesis invalidation from arbitrary stop distance.
- Never widen risk after entry merely to avoid realizing a loss.
- Choose target geometry, partials, breakeven and runner/trailing style according to the specific opportunity and remaining structure/liquidity path.
- Do not force an early exit solely because of low-timeframe noise if the thesis remains intact.
- Do not hold a broken thesis solely to avoid booking a loss.

## Experience discipline

- Learn from measured winners and losers.
- Compare similar setups by lane, side, structure, location, flow, derivatives and market regime.
- Ask what is genuinely similar and what is materially different.
- A single trade never becomes a rule.
- Winning history is not proof that the current trade is good; losing history is not an automatic veto.
- Lessons remain soft context and must not mutate code, capital settings, hard safety or exchange constraints.

## Professional process

1. Understand regime and location.
2. Keep both LONG and SHORT hypotheses alive initially.
3. Decide what evidence would materially discriminate between them.
4. Discount stale, partial, duplicated or proxy evidence.
5. Separate direction from entry quality.
6. Define thesis, invalidation and reward path coherently.
7. Use WAIT when edge is not worth taking.
8. After closure, study the measured outcome and update SHADOW experience memory without converting the lesson into a hard rule.
