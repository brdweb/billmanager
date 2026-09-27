import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('web release analytics configuration', () => {
  it('passes the dedicated product analytics variables into the image build', () => {
    const workflow = readFileSync(resolve(__dirname, '../../../../.github/workflows/release-web.yml'), 'utf8');

    expect(workflow).toContain('VITE_UMAMI_SCRIPT_URL=${{ vars.PRODUCT_UMAMI_SCRIPT_URL }}');
    expect(workflow).toContain('VITE_UMAMI_WEBSITE_ID=${{ vars.PRODUCT_UMAMI_WEBSITE_ID }}');
  });
});
