# Mercury - Personal Finance Tracker

## Overview

Mercury is a personal finance tracking application that helps users manage their budget through payroll tracking, recurring expenses, and one-off expenses. The application provides a calendar-style view of financial data with support for balance overrides and year-based data archiving.

The app features a conversion-focused landing page with multi-user authentication via Replit Auth (OpenID Connect), supporting sign-in with Google, GitHub, Apple, and email/password. Each user has isolated financial data stored in a cloud-based PostgreSQL database.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Single HTML file approach**: The entire React application lives in `index.html` using Babel standalone for JSX transformation
- **React 18**: Loaded via CDN (production builds from cdnjs)
- **No build step**: Babel compiles JSX in the browser at runtime
- **Styling**: Inline CSS with CSS custom properties (design tokens) for theming
- **Theme System**: Automatic light/dark mode based on system preference via `prefers-color-scheme` media query
- **Fonts**: Inter for UI text, Playfair Display for decorative elements (loaded from Google Fonts)

### Theme System
- **CSS Custom Properties**: All colors defined as design tokens (--bg-primary, --text-primary, --accent, etc.)
- **useTheme Hook**: Detects system preference and manages `data-theme` attribute on document root
- **Dark Theme**: Deep blue-black background (#0a0f1a) with gold accent (#d4af37)
- **Light Theme**: Clean white/gray background (#f8f9fa) with darker gold accent (#b8860b)
- **Canvas Elements**: MoneyRain and Chart.js use `isDark` flag for JavaScript-based color switching

### App Structure
- **AppShell**: Root component that manages authentication state and view navigation
- **HomePage**: Conversion-focused landing page with hero, features, stats, demo preview, and CTAs
- **MoneyRain**: Canvas-based Matrix-style animation with falling gold dollar signs; reacts to mouse movement with glow effect (theme-aware)
- **FinancialTracker**: Main application with dashboard and calendar views (protected, requires auth)

### Authentication
- **Replit Auth (OpenID Connect)**: Users sign in via Replit's OIDC provider
- **Supported providers**: Google, GitHub, Apple, email/password
- **Session management**: express-session with PostgreSQL storage (connect-pg-simple)
- **PKCE flow**: Secure authorization code grant with code verifier/challenge
- **Auth endpoints**:
  - `GET /api/login` - Initiates login flow
  - `GET /api/callback` - Handles OAuth callback
  - `GET /api/logout` - Destroys session and redirects to home
  - `GET /api/auth/user` - Returns current user or null

### Backend Architecture
- **Express.js server**: Serves static files and provides a REST API
- **Single entry point**: `Mercury/index.js` handles static serving, auth, and API routes
- **Port**: Runs on port 5000
- **Protected API endpoints** (require authentication):
  - `GET /api/data` - Retrieve user's financial data
  - `POST /api/data` - Save/update user's financial data (uses upsert)
  - `PATCH /api/data/:field` - Update a specific field
- **No caching**: Response headers set to prevent caching for fresh data

### Data Storage
- **PostgreSQL**: Primary data store using the `pg` library
- **Multi-user design**: Each user has isolated data via `user_id` foreign key
- **Database tables**:
  - `users`: Stores user profile info (replit_id, email, name, profile_image)
  - `sessions`: PostgreSQL session storage for authentication
  - `mercury_data`: Financial data per user with JSONB columns
- **JSONB columns** in mercury_data:
  - `initial_balances`: Starting balance per year
  - `payrolls`: Array of payroll entries
  - `recurring_expenses`: Array of recurring expense entries
  - `one_off_expenses`: Array of one-time expense entries
  - `balance_overrides`: Manual balance corrections by date
  - `archived_years`: Historical year data
- **Data versioning**: `version` field supports future migrations (currently version 1)
- **Upsert pattern**: POST endpoint uses INSERT ... ON CONFLICT for reliable data persistence

### Data Model
The application tracks:
1. **Payrolls**: Income sources with amounts and schedules
2. **Recurring Expenses**: Regular bills and subscriptions
3. **One-off Expenses**: Single transactions
4. **Balance Overrides**: Manual balance corrections for specific dates
5. **Year Management**: Current year tracking with archival support

## External Dependencies

### Database
- **PostgreSQL**: Required for data persistence and session storage
- Connection via `DATABASE_URL` environment variable
- Uses `pg` npm package for database operations

### CDN Dependencies (Frontend)
- React 18.2.0 (production build)
- ReactDOM 18.2.0 (production build)
- Babel Standalone 7.23.5 (for JSX compilation)
- Google Fonts (Inter, Playfair Display)

### npm Dependencies
- `express@^4.18.2`: Web server and routing
- `pg@^8.17.1`: PostgreSQL client
- `express-session`: Session management
- `connect-pg-simple`: PostgreSQL session store
- `openid-client@^6.x`: OIDC client for authentication

### Environment Variables
- `DATABASE_URL`: PostgreSQL connection string (required)
- `SESSION_SECRET`: Secret for signing session cookies (auto-provided by Replit)
- `REPL_ID`: Replit project ID, used as OIDC client ID (auto-provided)
- `ISSUER_URL`: OIDC issuer URL (defaults to https://replit.com/oidc)
- `REPLIT_DEV_DOMAIN` / `REPLIT_DOMAINS`: Domain for OAuth callback URLs (auto-provided)
- `PORT`: Server port (defaults to 5000)

## Recent Changes

- **January 2026**: Added light/dark theme system with automatic system preference detection using CSS custom properties and useTheme hook
- **January 2026**: Added comprehensive mobile responsiveness to FinancialTracker app with CSS media queries for header, dashboard grids, panels, calendar table, and form overlays
- **January 2026**: Added interactive Matrix-style "Money Rain" animation to the homepage hero background (canvas-based, gold dollar signs with mouse glow effect)
- **January 2026**: Added Replit Auth (OpenID Connect) for multi-user authentication
- **January 2026**: Added users table and modified database schema for user isolation
- **January 2026**: Updated all API endpoints to be user-specific and protected with authentication
- **January 2026**: Enhanced homepage to show login/logout UI and user profile information
- **January 2026**: Added session management with PostgreSQL-backed session storage
- **January 2026**: Added conversion-focused homepage with hero section, features grid, stats, demo preview, and CTAs
- **January 2026**: Migrated from file-based storage to PostgreSQL database
- **January 2026**: Fixed port configuration to use port 5000 for Replit compatibility
- **January 2026**: Added cache control headers to prevent stale data issues
