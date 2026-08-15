import { describe, expect, it } from 'vitest';

import { escapeCsvCell, escapeHtml } from './exportEncoding';

describe('export encoding', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=1', '\r=1'])(
    'neutralizes spreadsheet formula input %j',
    (value) => expect(escapeCsvCell(value)).toBe(`'${value}`),
  );

  it('preserves CSV structure after neutralizing formulas', () => {
    expect(escapeCsvCell('=HYPERLINK("https://example.test")')).toBe(
      '"\'=HYPERLINK(""https://example.test"")"',
    );
  });

  it('escapes active HTML', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    );
  });
});
