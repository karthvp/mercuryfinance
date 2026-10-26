---
name: Finance test safety
description: Safety boundary for repeatable financial browser regressions and Replit browser runtime constraints.
---

Keep financial browser regression data entirely simulated; do not seed or alter real financial records or add production authentication bypasses.

**Why:** The user explicitly prohibited modifying real financial records or bypassing production authentication for regression testing. A mistaken test target could otherwise overwrite personal financial data.

**How to apply:** Maintain a fail-closed network boundary for browser fixtures. Test real API/auth behavior separately with disposable data stores, never by pointing these browser fixtures at a real account.

On Replit/Nix, prefer the environment's wrapped Chromium rather than trying to repair a downloaded Linux browser with a broad library-path override.

**Why:** Downloaded Chromium lacked native library paths here; mixing arbitrary Nix store libraries also introduced incompatible glibc versions. The environment's wrapped browser launched successfully without those overrides.

**How to apply:** Preserve a normal Playwright-installed-browser path for other operating systems while using a wrapped browser when available on Nix.
