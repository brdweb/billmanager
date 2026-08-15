import { describe, expect, it } from 'vitest';

import { escapeCSV } from '../utils/export';

describe('CSV export security', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=1', '\r=1'])(
    'neutralizes spreadsheet formula input %j',
    (value) => expect(escapeCSV(value)).toBe(`'${value}`),
  );

  it('quotes and neutralizes a formula containing CSV delimiters', () => {
    expect(escapeCSV('=HYPERLINK("https://example.test", "open")')).toBe(
      '"\'=HYPERLINK(""https://example.test"", ""open"")"',
    );
  });
});
