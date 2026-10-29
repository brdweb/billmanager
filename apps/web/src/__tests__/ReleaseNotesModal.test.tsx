import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ReleaseNotesModal } from '../components/ReleaseNotesModal';

const formatDate = Date.prototype.toLocaleDateString;
afterEach(() => { vi.restoreAllMocks(); });

it.each(['America/New_York', 'Pacific/Honolulu'])('preserves the release calendar day for viewers in %s', (timeZone) => {
  // Simulate the viewer's default timezone without depending on the CI host.
  vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (this: Date, locales, options) {
    return formatDate.call(this, locales, { timeZone, ...options });
  });
  render(<MantineProvider><ReleaseNotesModal opened onClose={() => undefined} /></MantineProvider>);
  expect(screen.getByText('October 29, 2026')).toBeVisible();
  expect(screen.queryByText('October 28, 2026')).not.toBeInTheDocument();
});
