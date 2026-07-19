/**
 * Release Notes Configuration
 *
 * HOW TO ADD RELEASE NOTES FOR A NEW VERSION:
 *
 * 1. Add a new entry at the TOP of the `releaseNotes` array (newest first)
 * 2. Update the version number in these files:
 *    - apps/server/config.py (SERVER_VERSION)
 *    - apps/server/openapi.yaml
 *    - apps/web/package.json
 *    - apps/web/package-lock.json
 *    - README.md (What's New section)
 * 3. The `currentVersion` export automatically uses the first entry's version
 *
 * RELEASE NOTE STRUCTURE:
 * {
 *   version: '3.8.0',           // Semver version string
 *   date: '2026-02-01',         // ISO date (YYYY-MM-DD)
 *   title: 'Feature Name',      // Short title for the release
 *   sections: [                 // Array of sections (New Features, Bug Fixes, etc.)
 *     {
 *       heading: 'New Features',
 *       items: ['Feature 1 description', 'Feature 2 description'],
 *     },
 *   ],
 * }
 *
 * COMMON SECTION HEADINGS:
 * - 'New Features' - Major new functionality
 * - 'Improvements' - Enhancements to existing features
 * - 'Bug Fixes' - Fixed issues
 * - 'Security' - Security-related changes
 * - 'Breaking Changes' - Changes requiring user action
 *
 * The release notes modal automatically shows to users when they log in
 * after a new version is released (tracked via localStorage).
 */

export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  sections: {
    heading: string;
    items: string[];
  }[];
}

export const releaseNotes: ReleaseNote[] = [
  {
    version: '4.4.1',
    date: '2026-07-19',
    title: 'Dependency and Toolchain Maintenance',
    sections: [
      {
        heading: 'Improvements',
        items: [
          'Updated the Expo SDK 57 runtime, navigation, form, icon, localization, and build packages to the versions validated for internal iOS and Android builds',
          'Refreshed the web compiler, lint, icon, and localization dependencies and moved GitHub Actions to the current Node setup action',
        ],
      },
      {
        heading: 'Backend Reliability',
        items: [
          'Updated the Resend and Stripe SDKs for additive API improvements, corrected response and error handling, and reduced Stripe client cold-start latency',
          'Dependency audits found no known vulnerabilities, and this maintenance release requires no database or API migration',
        ],
      },
    ],
  },
  {
    version: '4.4.0',
    date: '2026-07-16',
    title: 'Deletion Safety and Self-Hosted Reliability',
    sections: [
      {
        heading: 'Administrator Notice',
        items: [
          'On first startup after upgrading, PostgreSQL migration 20260716_01 replaces three foreign-key constraints and may briefly block writes while existing rows are validated; use a normal maintenance window and start one application replica first',
          'No manual SQL or data conversion is required; the migration aligns bill-share, category-budget, and registered-device cleanup with the schema already intended by BillManager',
        ],
      },
      {
        heading: 'Security and Data Integrity',
        items: [
          'Full account erasure now includes nested managed users and their bill groups, cancels live Stripe subscriptions first, and preserves local data when Stripe cannot confirm cancellation',
          'User, bill, and bill-group deletion now cleans up dependent authentication, sharing, ownership, and audit records without leaving billable subscriptions or triggering foreign-key server errors',
        ],
      },
      {
        heading: 'Self-Hosted Improvements',
        items: [
          'Archived bills are reachable again, shared-bill access works outside SaaS mode, and the reminder drawer is fully translated',
          'The complete backend suite now runs independently in both self-hosted and SaaS modes to catch deployment-specific regressions',
        ],
      },
    ],
  },
  {
    version: '4.3.3',
    date: '2026-07-15',
    title: 'BillManager Mobile Alpha-1',
    sections: [
      {
        heading: 'New Features',
        items: [
          'BillManager Mobile is now marked 1.0.0-alpha.1 (Alpha-1) for internal iOS and Android testing with native-adaptive navigation, encrypted offline data, local reminders, biometrics, passkeys, and widgets',
        ],
      },
      {
        heading: 'Improvements',
        items: [
          'Mobile Settings and release details display the Alpha-1 milestone while generated native builds retain the store-compatible 1.0.0 version',
        ],
      },
      {
        heading: 'Bug Fixes',
        items: [
          'One-time bills now stop after their scheduled occurrence in mobile reminders, calendar, analytics, and optimistic payment handling',
          'Shared-bill invitations now display the canonical owner and recipient details while preserving compatibility with older servers',
        ],
      },
    ],
  },
  {
    version: '4.3.2',
    date: '2026-07-15',
    title: 'Security and Data Integrity Coverage',
    sections: [
      {
        heading: 'Security',
        items: [
          'Added regression coverage that verifies bill moves, budget writes, and payment changes cannot cross bill-group boundaries',
        ],
      },
      {
        heading: 'Data Integrity',
        items: [
          'Offline sync now has regression coverage for rejecting cross-group mutations and preserving newer server data when a client is stale',
        ],
      },
      {
        heading: 'Bug Fixes',
        items: [
          'Restored parity in v2 bill-group administration, including access-listing before deletion and account-level access controls',
        ],
      },
    ],
  },
  {
    version: '4.3.1',
    date: '2026-07-15',
    title: 'Unified Settings and Localization Fixes',
    sections: [
      {
        heading: 'Improvements',
        items: [
          'Account settings and administration now share a full-page workspace; regular users see Settings, while admins also receive Users and Bill Groups tabs',
        ],
      },
      {
        heading: 'Bug Fixes',
        items: [
          'Choosing English now uses USD and choosing German uses EUR, including when a saved language preference is restored after a reload',
          'Bill-group deletion can once again list affected users through the v2 database-access endpoint before confirmation',
        ],
      },
    ],
  },
  {
    version: '4.3.0',
    date: '2026-07-10',
    title: 'Internationalization and Self-Hosted Flexibility',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Choose English or German in Settings; interface text, dates, exports, and print output follow your selected language',
          'Self-hosted deployments can set DEFAULT_CURRENCY and DEFAULT_LOCALE to format amounts for their region',
        ],
      },
      {
        heading: 'Improvements',
        items: [
          'Reminder alerts now sit at the lower-right and hide while their slide-out drawer is open',
          'Web and mobile libraries, Python tooling, and supported Node.js and PostgreSQL runtimes were refreshed',
        ],
      },
    ],
  },
  {
    version: '4.2.2',
    date: '2026-07-08',
    title: 'Analytics Workspace and Performance Update',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Analytics sections can now be collapsed and reordered with a per-user saved layout',
          'Cash Flow Forecast moved into Analytics alongside the other planning views',
          'Reminder alerts now appear as a floating bell indicator and open in a side drawer',
        ],
      },
      {
        heading: 'Improvements',
        items: [
          'Category spending is now visualized as stacked bar and area charts instead of category budget cards',
          'The web bundle is split by route, modal, and vendor area to remove the large bundle warning and reduce the initial app chunk',
          'Mantine, Recharts, Python dependencies, PostgreSQL defaults, and the production Python runtime were updated',
        ],
      },
    ],
  },
  {
    version: '4.2.1',
    date: '2026-07-08',
    title: 'Dark Mode Reminder Alert Readability',
    sections: [
      {
        heading: 'Bug Fixes',
        items: [
          'Reminder alert cards now use theme-aware surfaces so bill names stay readable in dark mode',
          'Overdue alert cards use the same dark-mode-safe card treatment',
        ],
      },
    ],
  },
  {
    version: '4.2.0',
    date: '2026-07-08',
    title: 'Provider-Neutral Outbound Email',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Self-hosted installs can send password reset, verification, invitation, shared bill, and email OTP messages through SMTP',
          'Outbound email can now be selected with EMAIL_PROVIDER=smtp, resend, or none',
          'SMTP configuration supports host, port, STARTTLS, SSL, optional authentication, timeout, sender, and app URL settings',
        ],
      },
      {
        heading: 'Improvements',
        items: [
          'Existing Resend configurations continue to work for hosted and current deployments',
          'Admin UI, Docker Compose, environment examples, and README documentation now describe outbound email instead of Resend-only setup',
          'Self-hosted documentation clarifies that BillManager does not bundle a production SMTP server and should use a mail provider or existing relay',
        ],
      },
    ],
  },
  {
    version: '4.1.1',
    date: '2026-07-08',
    title: 'Self-Hosted OIDC Providers',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Generic OIDC sign-in for self-hosted providers such as Authelia, Authentik, Keycloak, and other OpenID Connect IdPs',
          'Configurable token endpoint client authentication with client_secret_post, client_secret_basic, none, or auto modes',
          'Configurable OIDC claim mapping for email, username, and display-name claims',
        ],
      },
      {
        heading: 'Security',
        items: [
          'OIDC authorization code flow uses PKCE, nonce validation, signed state, JWKS ID token verification, and state replay protection',
          'Linked-account sign-in safely matches existing users by provider subject or verified email',
          'Optional email verification bypass is available for trusted self-hosted providers that do not emit email_verified',
        ],
      },
    ],
  },
  {
    version: '4.1.0',
    date: '2026-06-08',
    title: 'Planning, Budgets, and Shared Bill Settlements',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Category budgets with monthly limits, budget progress, and over-budget indicators in Analytics',
          'Cash Flow Forecast on the Dashboard with starting balance, 30/60/90 day horizons, projected balances, and upcoming cash events',
          'Settlements page for shared bills showing what is owed to you, what you owe, person-level net balances, and recent settled shares',
          'Per-bill reminder preferences with upcoming, due today, deposit, and overdue alert support',
        ],
      },
      {
        heading: 'Improvements',
        items: [
          'Bills now support categories and notes throughout create, edit, filters, exports, and sync payloads',
          'Shared bill payables are included in cash-flow projections so split expenses are visible before they are paid',
          'Dashboard reminder alerts now honor each bill\'s configured reminder windows',
        ],
      },
    ],
  },
  {
    version: '4.0.2',
    date: '2026-03-30',
    title: 'Security Hardening and Release Stability',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Social Login (OIDC) - Sign in with Google, Apple, Microsoft, or any OIDC provider',
          'Microsoft login with Azure AD multi-tenant support',
          'Generic OIDC/SSO integration for self-hosted deployments (Keycloak, Authentik, Okta, etc.)',
          'Configurable claim mapping for custom OIDC providers',
          'Two-Factor Authentication - Email OTP and passkey (WebAuthn) support',
          'Recovery codes for 2FA backup access',
          'Linked Accounts management - connect and disconnect OAuth providers',
          'Security Settings page for managing 2FA and passkeys',
        ],
      },
      {
        heading: 'Security',
        items: [
          'ID token signature verification for supported social login providers',
          'Cryptographically secure OTP generation',
          'OAuth state token replay protection',
          'Brute-force protection on 2FA verification',
          'Email normalization for consistent account linking',
        ],
      },
    ],
  },
  {
    version: '3.8.1',
    date: '2026-02-09',
    title: 'Dashboard & Analytics Overhaul',
    sections: [
      {
        heading: 'New Features',
        items: [
          'New Dashboard page with stat cards, upcoming bills, and recent payments',
          'New Calendar page with multi-month view and bill due date indicators',
          'New Analytics page with spending trends, account breakdown, year-over-year comparison, and yearly summary',
          'Clickable stat cards on Dashboard navigate to filtered Bills view',
          'Filter indicator banner on Bills page shows active filters with clear button',
          'Payment History is now a dedicated sidebar navigation link',
        ],
      },
      {
        heading: 'Improvements',
        items: [
          'Sidebar calendar click navigates to Bills page filtered by selected date',
          'Upcoming Bills sidebar filters navigate to Bills page',
          'All Payments page defaults to past 30 days date range',
          'Monthly Total stat card shows paid and remaining breakdown',
          'Yearly summary cards show labeled Expenses, Deposits, and Net totals',
          'Version and license footer pinned to bottom of sidebar',
          'Need Help link visible in sidebar footer on every page',
        ],
      },
      {
        heading: 'Bug Fixes',
        items: [
          'Fixed editing payments from All Payments page not saving changes',
          'Fixed deleting payments from All Payments page not refreshing the list',
          'Fixed yearly summary background too bright in dark mode',
          'Fixed "Today" button text clipped on Calendar page',
        ],
      },
    ],
  },
  {
    version: '3.7.0',
    date: '2026-01-19',
    title: 'All Buckets View',
    sections: [
      {
        heading: 'New Features',
        items: [
          'All Buckets view - See and manage bills from all your bill groups in one place',
          'Create bills with explicit bucket selection when viewing All Buckets',
          'Move existing bills between buckets when editing',
          'Monthly stats aggregate across all accessible databases in All Buckets mode',
          'Mobile app fully supports All Buckets view with bucket selector',
        ],
      },
      {
        heading: 'Bug Fixes',
        items: [
          'Edit user modal now correctly pre-selects bill group checkboxes',
          'Database dropdown updates immediately after changing user permissions',
        ],
      },
    ],
  },
  {
    version: '3.6.1',
    date: '2026-01-15',
    title: 'Security Hardening',
    sections: [
      {
        heading: 'Security',
        items: [
          'Prevented exception information exposure in API responses',
          'Updated dependencies to address security vulnerabilities',
          'Improved input validation across API endpoints',
        ],
      },
      {
        heading: 'Bug Fixes',
        items: [
          'Fixed CI test database configuration issues',
          'Resolved TypeScript errors in API client',
        ],
      },
    ],
  },
  {
    version: '3.6.0',
    date: '2026-01-10',
    title: 'Shared Bills',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Share bills with other users for split expenses',
          'Configure split amounts: percentage, fixed amount, or equal split',
          'Track when sharees mark their portion as paid',
          'Payments from sharees appear as income in your trends',
          'Pending share invitations with accept/decline workflow',
        ],
      },
      {
        heading: 'Improvements',
        items: [
          'Enhanced payment history with share payment indicators',
          'New Shared Bills section in mobile app',
        ],
      },
    ],
  },
  {
    version: '3.5.0',
    date: '2025-12-20',
    title: 'Mobile App & Push Notifications',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Native mobile app for Android (iOS coming soon)',
          'Push notifications for bill reminders',
          'Offline-first sync with conflict resolution',
          'Device management in account settings',
        ],
      },
      {
        heading: 'API',
        items: [
          'New JWT-based API v2 for mobile apps',
          'Delta sync endpoint for efficient data transfer',
          'Device registration for push notifications',
        ],
      },
    ],
  },
  {
    version: '3.4.0',
    date: '2025-12-01',
    title: 'User Invitations',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Email-based user invitations',
          'Invite users with pre-configured bill group access',
          'Invited users set their own password on first login',
          'Manage pending invitations in admin panel',
        ],
      },
    ],
  },
];

export const currentVersion = releaseNotes[0].version;

// localStorage key for tracking seen version
const SEEN_VERSION_KEY = 'billmanager_seen_version';

// Helper function to check if there are new release notes to show
export function hasUnseenReleaseNotes(): boolean {
  const seenVersion = localStorage.getItem(SEEN_VERSION_KEY);
  if (!seenVersion) return true;
  return seenVersion !== currentVersion;
}

// Helper function to mark current version as seen
export function markVersionAsSeen(): void {
  localStorage.setItem(SEEN_VERSION_KEY, currentVersion);
}

// Helper function to get initial index for a version
export function getVersionIndex(version?: string): number {
  if (!version) return 0;
  const index = releaseNotes.findIndex((r) => r.version === version);
  return index >= 0 ? index : 0;
}
