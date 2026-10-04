# R2544.34: production request budget and lossless market rows

The installed R33 last PASS-1 request was blocked at 57,411 / 48,000 UTF-8 bytes.
Its market packet consumed 45,534 bytes. Protected R31/R32 overlays and numeric
truth correctly survived the previous budget stages, but repeated field names
left insufficient room for the real question envelope.

A historical public SANDUSDT mirror snapshot and its actual PASS-1 builder
envelope are retained in `test/fixtures/r2544-34-production-pass1.json`. This is
public market data captured on 2026-10-04, with an offline routing record and no
account, credential or exchange order data. It is not a current entry signal.
R33 prepares this fixture to 51,451 bytes and blocks it. R34 prepares the same
fixture to 39,211 bytes (initial envelope 92,935 bytes). The market packet after
existing compaction changes from 44,186 to 31,946 bytes.

`jev-wire-market.js` shares repeated ordered field names in `wire.fields` and
represents matching nested objects as tagged JSON rows. The packet contains its
own decoding instructions. This is neither base64 nor a prose market summary.
Encoding applies only after existing optional/duplicate context compaction,
when a request still exceeds its target, and only when it saves bytes. A strict
round-trip check restores the identical JSON packet. Ambiguous reserved tags
skip encoding; invalid schemas/rows throw. No prices, nulls, false, zeros,
timestamps, observed-vs-estimated labels or remaining evidence are removed by
this stage. Smaller requests keep their existing representation.

Protected truth hashes and the decision mirror expand the actual wire packet.
The unchanged hard cap remains 48,000 bytes. Targets remain PASS-1 42,000 and
PASS-2 46,000; BURST now has a separate 36,000-byte target. An irreducible
oversized numeric packet still fails closed. This cannot guarantee that every
arbitrarily large packet fits: numeric evidence is never truncated to force it.

Metadata logs include market section sizes before/after and round-trip evidence.
Office shows the last request time, hard-cap headroom and representation size.
It counts usable narrative frames rather than merely counting frame keys, and
distinguishes an empty authoritative free-route catalog from pending discovery.

Validation on 2026-10-04: full `node --test brainhub/test/*.test.js` suite passes
678/678. Tests cover the captured request, verbose optional context, actual
PASS-1/PASS-2/BURST transport builders, mirror parity, input immutability,
malformed rows, unchanged small requests and fail-closed numeric overflow.
The R33 tailnet test initially rejected the word “Funnel” in a comment; it now
checks executable lines and retains the prohibition on Funnel commands.

A real typesafe/jev-1.13 readback audit returned HTTP 200 with 6/6 correct field
choices from the encoded historical packet (33,879-byte audit request, recorded
cost $0.000939708). It tested 5m close, 15m trend-line active state, synthetic
45m status, L2 sequence health, observed liquidation count and modeled-zone
observed=false. It authorized no trading action. These six readbacks are bounded
evidence of model interpretation, not proof of future trade quality or all field
interpretations. The runtime request log now ends with this OTHER audit, so an
old blocked PASS-1 and a later successful readback must not be conflated.

Deployment identity: PC R2544.34-JEV-CONTEXT-WIRE-BUDGET, Office
2.5.14-R2544.34-JEV-Brain. The managed installer and root wrapper must match
the new commit, including the new codec module. Deployment remains an elevated
user action with LIVE off and no open positions. Before installation the actual
runtime remains R33; source and tests are not installation evidence.

Phone route verified locally with normal TLS validation: authenticated
`https://8z9rvd.tail8c30c4.ts.net:8443/health` returns R33 JSON, while an
unauthenticated request returns HTTP 401 JSON. Port 443 remains 9Router's Funnel
to 20128. Neither listener, token nor execution authority was changed here.
Android source 7128ec19017c5736240af0ec11fc55a62521b821 is the R33/8443 update;
Codemagic build 238 is documented in the supplied work-update PDF, but its APK
artifact, signature and actual phone installation are not verified in this run.
Do not claim phone acceptance from PC health checks alone.
