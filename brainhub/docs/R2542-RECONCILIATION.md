# R2542 Office reconciliation

The `stream symbol capacity reached` failure came from the 80-symbol public
market-data cache. It was unrelated to the configured position limit. The cache
now rotates least-recently requested subscriptions, protects open positions and
ignores late packets for removed subscriptions. If all slots are protected,
optional streaming evidence is unavailable and REST evidence continues.

## Execution accounting

Position capacity is the union of open symbols and genuinely pending symbols.
Duplicate symbols count once. An already-open symbol has its own rejection
reason. The existing execution mutex and final account-risk gate remain binding.

Reservations are persisted before submission. Known terminal exchange statuses
release them; an open position replaces its reservation. Expired, unsent RESERVED
records can be released. A submitted order with an unknown result does not expire
blindly. The read-only position ledger reconciles reservations even when LIVE is
OFF or capacity is full. Unreadable reservation state blocks new execution.

## Measurements

`/live/positions` includes `performance`, calculated from all SQLite journal rows.
5M_SCALP and 15M_TRADE have separate 60-minute and release-cohort views. Historical
missing R values stay unknown. Average/median R expose their sample count.
Breakeven trades are separate from losses. The old recent-trade list remains
bounded; the cohort report is not bounded by that list.

`R2542_OFFICE_EVENT` persists analysis and correlated decision/safety/order stages.
Office's main funnel uses the same records as its desk reports. Historical
decision telemetry is explicitly unavailable; it is not reconstructed from
profit/loss rows. New plans/trades use `R2542_JEV_TRADER_OFFICE`. Backfilling old
trades preserves their own provenance, or leaves it unknown.

Legacy live-ledger closes without eventId can already have a matching backfill.
Reporting retains the original ledger record when symbol, side, entry price,
quantity and entry time (within one second) match. It exposes excluded duplicate
identities in `performance.reconciliation`; raw historical rows are never changed.
Backfill checks that same complete identity before fetching income or appending a
record. Different entries in the same symbol remain separate trades.

Both live-ledger and backfill writers recheck persisted closes immediately before
the synchronous append. Restart recovery uses execution identity, with a bounded
legacy comparison of symbol, side, opening time and both quantity/entry price.
Conflicting explicit event IDs and a trade closed before the next entry are never
collapsed. Concurrent writers in both completion orders and restart are tested.
Learning's measured close samples use the same canonical rows through a temporary
read view; persistent learning rows and journal rows are preserved.

WAIT cannot retain MARKET_NOW timing. Missing reasons stay unspecified; old
setups are labeled legacy. Coverage rotation and a 60-second exact-evidence WAIT
dedupe reduce repeated analysis without changing entry thresholds or imposing a
new strategic veto. Any changed evidence causes another review.

Optional free evidence agents have cooldown/backoff and explicit failure status.
The free worker always uses `openrouter/free`. JEV final decisions continue after
optional evidence failure. The existing single transient JEV retry, daily USD 5
cap, safety rules, two-desk prompt and chart contracts remain unchanged.

## Installation and validation

Run `INSTALL-R2542-JEV-TRADER-OFFICE.ps1`; `-SourceDirectory` selects local tested
sources, and `-VerifyOnly` verifies an already-installed runtime. Run with a
Windows account/integrity level able to stop the existing Node processes.
Process discovery uses the script path, or an identity-checked loopback listener
when Windows hides CommandLine. Tailscale listeners on other addresses are not
selected. Failure to stop aborts before copying source files.

The installer disarms LIVE, creates a backup, runs regression checks, updates
sources, starts fail-closed, and verifies Office, chart parity and LIVE OFF. Source
rollback preserves runtime database/reservations/settings. Logs are written to
`C:\BrainHubInstall\LATEST-INSTALL.log` and the R2542 per-run directory, including
failed runs. No test calls a real order endpoint. No automatic arming is performed.

CI markers after the Node regression suite:

- `R2542_TRADER_OFFICE_RECONCILIATION_OK`
- `R2542_CAPACITY_ACCOUNTING_OK`
- `R2542_LANE_PERFORMANCE_OK`

Android source and APK version are unchanged. Existing PC-only, 45-second
freshness and three-failure fail-closed contracts continue to be tested.
