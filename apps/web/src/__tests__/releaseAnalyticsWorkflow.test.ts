import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('web release analytics configuration', () => {
  const workflow = readFileSync(resolve(__dirname, '../../../../.github/workflows/release-web.yml'), 'utf8');

  function namedStep(name: string) {
    const start = workflow.indexOf(`      - name: ${name}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = workflow.indexOf('\n      - name:', start + 1);
    return workflow.slice(start, end === -1 ? undefined : end);
  }

  it('keeps every canonical public image tag free of product analytics build arguments', () => {
    const publicBuild = namedStep('Build and push public self-hosted image');

    expect(publicBuild).toContain('tags: ${{ steps.meta.outputs.tags }}');
    expect(publicBuild).not.toContain('PRODUCT_UMAMI_');
    expect(publicBuild).not.toContain('VITE_UMAMI_');
    expect(publicBuild).not.toContain('build-args:');
  });

  it('publishes a configured SaaS build only to the separate SaaS image', () => {
    const saasMetadata = namedStep('Generate SaaS Docker metadata');
    const saasBuild = namedStep('Build and push SaaS image');

    expect(workflow).toContain('SAAS_IMAGE_NAME: ${{ github.repository_owner }}/billmanager-saas');
    expect(saasMetadata).toContain('images: ${{ env.REGISTRY }}/${{ env.SAAS_IMAGE_NAME }}');
    expect(saasMetadata).toContain('type=raw,value=${{ steps.release.outputs.version }}');
    expect(saasBuild).toContain("if: steps.saas-analytics.outputs.configured == 'true'");
    expect(saasBuild).toContain('VITE_UMAMI_SCRIPT_URL=${{ vars.PRODUCT_UMAMI_SCRIPT_URL }}');
    expect(saasBuild).toContain('VITE_UMAMI_WEBSITE_ID=${{ vars.PRODUCT_UMAMI_WEBSITE_ID }}');
    expect(saasBuild).toContain('tags: ${{ steps.meta-saas.outputs.tags }}');
    expect(saasBuild).not.toContain('steps.meta.outputs.tags');
  });

  it('skips an unconfigured SaaS image and rejects a partial configuration', () => {
    const validation = namedStep('Validate SaaS analytics configuration');

    expect(validation).toContain('if [[ -z "$SCRIPT_URL" && -z "$WEBSITE_ID" ]]');
    expect(validation).toContain('echo "configured=false"');
    expect(validation).toContain('elif [[ -z "$SCRIPT_URL" || -z "$WEBSITE_ID" ]]');
    expect(validation).toContain('exit 1');
    expect(validation).toContain('echo "configured=true"');
  });
});
