import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { REUSE, validateReuse } from './ios-qa-reuse.mjs';
const run = { id: REUSE.run, event: 'workflow_dispatch', head_branch: 'main', head_sha: REUSE.source,
  repository: { full_name: 'brdweb/billmanager' }, head_repository: { full_name: 'brdweb/billmanager' },
  path: '.github/workflows/ios-simulator-qa.yml', status: 'completed' };
const jobs = { jobs: [{ name: 'Native Release simulator smoke', steps: [{ name: 'Build and exercise the native Simulator app', conclusion: 'success' }] }] };
const manifest = { sourceCommit: REUSE.source, appArchiveSha256: REUSE.archiveSha256,
  configuration: 'Release', platform: 'iOS Simulator', mobileVersion: '1.2.0', binaryArchitectures: ['arm64'],
  productionTransport: true, signing: false, designPreview: false, generatedOtaEnabled: false,
  sentryUploadEnabled: false, sentryDsnConfigured: false };
const result = { exitCode: 0 };
describe('pinned native archive reuse', () => {
  it('accepts only the reviewed successful native build even though later capture failed', () => {
    expect(() => validateReuse(run, jobs, manifest, result, REUSE.archiveSha256)).not.toThrow();
  });
  it.each([
    ['event', 'pull_request'], ['head_branch', 'unreviewed'], ['head_sha', 'different'],
    ['id', 123], ['path', '.github/workflows/other.yml'], ['repository', { full_name: 'attacker/fork' }],
    ['head_repository', { full_name: 'attacker/fork' }],
  ])('rejects untrusted run metadata %s', (key, value) => {
    expect(() => validateReuse({ ...run, [key]: value }, jobs, manifest, result, REUSE.archiveSha256)).toThrow();
  });
  it('rejects changed bytes, failed native build, debug, architecture and transport drift', () => {
    expect(() => validateReuse(run, jobs, manifest, result, 'different')).toThrow();
    expect(() => validateReuse(run, { jobs: [] }, manifest, result, REUSE.archiveSha256)).toThrow();
    for (const patch of [{ configuration: 'Debug' }, { binaryArchitectures: ['x86_64'] }, { productionTransport: false }, { generatedOtaEnabled: true }, { sentryDsnConfigured: true }, { sourceCommit: 'different' }]) {
      expect(() => validateReuse(run, jobs, { ...manifest, ...patch }, result, REUSE.archiveSha256)).toThrow();
    }
  });
  it('keeps native reuse before the only reviewer-secret step and skips compilation', () => {
    const workflow = parse(readFileSync(new URL('../../../.github/workflows/ios-simulator-qa.yml', import.meta.url), 'utf8'));
    const steps = workflow.jobs.simulator.steps;
    const reuse = steps.findIndex(step => step.name === 'Verify and reuse the reviewed native Simulator archive');
    const secret = steps.findIndex(step => step.env?.QA_REVIEWER_PASSWORD);
    expect(reuse).toBeLessThan(secret);
    expect(steps[reuse].run).toContain('[[ "$CAPTURE_ENABLED" == true ]]');
    expect(steps[reuse].run).not.toContain('secrets.');
    expect(steps.find(step => step.name === 'Build and exercise the native Simulator app').if).toBe('!inputs.reuse_reviewed_build');
    expect(workflow.on.workflow_dispatch.inputs.reuse_reviewed_build.default).toBe(false);
  });
});
