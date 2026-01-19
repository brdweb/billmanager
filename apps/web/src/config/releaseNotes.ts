/**
 * Release Notes Configuration
 *
 * HOW TO ADD RELEASE NOTES FOR A NEW VERSION:
 *
 * 1. Add a new entry at the TOP of the `releaseNotes` array (newest first)
 * 2. Update the version number in these files:
 *    - apps/server/app.py (search for 'version': - two occurrences)
 *    - apps/web/package.json
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
