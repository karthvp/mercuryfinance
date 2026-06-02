# Threat Model

## Project Overview

Mercury is a public personal-finance web app deployed on Replit. It uses a single-file React frontend in `Mercury/index.html`, an Express server in `Mercury/index.js`, Replit OIDC for sign-in, and PostgreSQL for session and user financial data storage.

Production scan scope assumes `NODE_ENV=production`, Replit-managed TLS, and a public deployment (`https://mercuryfinance.replit.app`). Development-only sandboxes and local-only artifacts are out of scope unless they are actually reachable from the deployed app.

## Assets

- **User financial records** — payrolls, expenses, debts, overrides, archived years, and derived balances stored in `mercury_data.app_data`. Exposure would reveal sensitive personal finance history.
- **User sessions and identities** — session cookies plus the user profile data stored in `users` and surfaced through `/api/auth/user`. Compromise enables account access.
- **OIDC login flow state** — PKCE verifier, state, and nonce stored in the session during login. Weak handling here could let an attacker spoof or interfere with authentication.
- **Application secrets and infrastructure access** — `DATABASE_URL`, `SESSION_SECRET`, and server-side database access. Leakage could expose all user data.

## Trust Boundaries

- **Browser ↔ Express API** — all browser input is untrusted. The server must authenticate and validate every request before reading or modifying finance data.
- **Express API ↔ PostgreSQL** — the server has direct write access to user and session tables. Injection or authorization failures here would expose or alter all tenant data.
- **Express API ↔ Replit OIDC provider** — the app trusts identity claims returned by the issuer and must bind callbacks to the correct session state.
- **Public ↔ Authenticated routes** — `/`, `/api/login`, `/api/callback`, `/api/logout`, `/api/auth/user`, and any statically served files are publicly reachable; `/api/data` and `/api/data/:field` are intended to require a valid session.

## Scan Anchors

- **Production entry points:** `Mercury/index.js`, `Mercury/index.html`
- **Highest-risk code areas:** OIDC callback/session handling, `/api/data` read-write routes, `express.static(__dirname)`, and third-party CDN script loading in `index.html`
- **Surface split:** Public routes are `/`, auth endpoints, and static assets; authenticated routes are `/api/data` and `/api/data/:field`; no admin-only surface is present
- **Usually ignore unless proven reachable:** `.local/`, workflow logs, root-level tooling files, and `node_modules/`

## Threat Categories

### Spoofing

Users authenticate through Replit OIDC and a server-side session. The app must ensure that login state, PKCE verifier, nonce, and callback handling stay bound to the same user session, and that only a valid authenticated session can reach finance-data endpoints.

### Tampering

Authenticated users can write large JSON documents that drive all budgeting logic. The server must validate user-controlled data before persistence and must ensure one user cannot modify another user's record. Client-side rules alone are not trusted.

### Information Disclosure

Mercury stores highly sensitive personal finance data. API responses, static file serving, logs, and error handling must not expose other users' records, secrets, or internal server implementation details to the public internet.

### Denial of Service

Public routes and authenticated write routes must not allow attackers to exhaust storage or server resources with oversized or repeated requests. Any production-reachable expensive operation should have bounded input size and predictable server work.

### Elevation of Privilege

There is no admin tier, so the main privilege boundary is tenant isolation. Every data access path must be scoped by the authenticated user on the server side, and public routes must not accidentally expose privileged server files or functionality.