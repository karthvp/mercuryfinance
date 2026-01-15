# Mercury - Personal Finance Tracker

## Overview

Mercury is a personal finance tracking application that helps users manage their budget through payroll tracking, recurring expenses, and one-off expenses. The application provides a calendar-style view of financial data with support for balance overrides and year-based data archiving.

The app features a conversion-focused landing page and uses a single-page React frontend served via Express, with PostgreSQL for persistent cloud data storage. All financial data is stored in a single database row using JSONB columns for flexibility.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Single HTML file approach**: The entire React application lives in `index.html` using Babel standalone for JSX transformation
- **React 18**: Loaded via CDN (production builds from cdnjs)
- **No build step**: Babel compiles JSX in the browser at runtime
- **Styling**: Inline CSS in the HTML file with a dark theme featuring gold accent colors (#d4af37)
- **Fonts**: Inter for UI text, Playfair Display for decorative elements (loaded from Google Fonts)

### App Structure
- **AppShell**: Root component that manages view state (homepage vs tracker app)
- **HomePage**: Conversion-focused landing page with hero, features, stats, demo preview, and CTAs
- **FinancialTracker**: Main application with dashboard and calendar views

### Backend Architecture
- **Express.js server**: Serves static files and provides a REST API
- **Single entry point**: `index.js` handles both static file serving and API routes
- **Port**: Runs on port 5000
- **API endpoints**:
  - `GET /api/data` - Retrieve all financial data
  - `POST /api/data` - Save/update financial data (uses upsert)
  - `PATCH /api/data/:field` - Update a specific field
- **No caching**: Response headers set to prevent caching for fresh data

### Data Storage
- **PostgreSQL**: Primary data store using the `pg` library
- **Single-row design**: All user data stored in one row (enforced by `id = 1` constraint)
- **JSONB columns**: Flexible schema for financial data types:
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
- **PostgreSQL**: Required for data persistence
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

### Environment Variables
- `DATABASE_URL`: PostgreSQL connection string (required)
- `PORT`: Server port (defaults to 5000)

## Recent Changes

- **January 2026**: Added conversion-focused homepage with hero section, features grid, stats, demo preview, and CTAs
- **January 2026**: Introduced AppShell component to manage homepage vs app navigation
- **January 2026**: Migrated from file-based storage to PostgreSQL database
- **January 2026**: Removed export/import functionality (data now persists in cloud database)
- **January 2026**: Fixed port configuration to use port 5000 for Replit compatibility
- **January 2026**: Added cache control headers to prevent stale data issues
