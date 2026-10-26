---
name: Forecast trust boundaries
description: Why legacy projections are not bank history and future bank feeds need an explicit balance cutoff.
---

Do not turn legacy scheduled income and expenses into confirmed transactions during migration. Keep that historical projection distinguishable from recorded actuals until the user verifies a balance.

**Why:** Mercury originally forecast from schedules and manual check-ins; it did not collect a bank transaction history. Fabricating actuals from that plan would create false evidence of deposits and payments.

**How to apply:** Preserve the legacy plan as an estimate, keep unmatched and overdue items visible, and do not label a provisional projection as guaranteed spending capacity.

A bank's current balance is not automatically a start-of-day checkpoint.

**Why:** A current bank balance can already include some same-day transactions. Applying all those transactions after that balance would count them twice.

**How to apply:** When adding bank synchronization, define a balance/transaction cutoff explicitly. Either derive a genuine opening balance or introduce precise snapshot timing; do not silently map an intraday bank balance into the manual date-only checkpoint convention.
