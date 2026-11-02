import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { parseRunId, validatePinnedRun, validateReuse } from './ios-qa-reuse.mjs';
const source = '1b51cd6edc7a31265cb94b338113f355a49ae175';
const archiveSha256 = 'a6858200b085981fab88fdf6a3759decfc64258d4fe51629bb72f3074563e622';
const runId = 41054807810;
const run = { id: runId, event: 'workflow_dispatch', head_branch: 'main', head_sha: source,
  repository: { full_name: 'brdweb/billmanager' }, head_repository: { full_name: 'brdweb/billmanager' },
  path: '.github/workflows/ios-simulator-qa.yml', status: 'completed' };
const jobs = { jobs: [{ name: 'Native Release simulator smoke', steps: [{ name: 'Build and exercise the native Simulator app', conclusion: 'success' }] }] };
const artifact = { name: `ios-simulator-qa-${source}`, expired: false, workflow_run: { id: runId, head_sha: source } };
const artifacts = { total_count: 1, artifacts: [artifact] };
const comparison = { status: 'ahead', base: source, merge_base: source };
const manifest = { sourceCommit: source, appArchiveSha256: archiveSha256,
  configuration: 'Release', platform: 'iOS Simulator', mobileVersion: '1.2.0', binaryArchitectures: ['arm64'],
  productionTransport: true, signing: false, designPreview: false, generatedOtaEnabled: false,
  sentryUploadEnabled: false, sentryDsnConfigured: false };
const result = { exitCode: 0 };
const workflow = parse(readFileSync(new URL('../../../.github/workflows/ios-simulator-qa.yml', import.meta.url), 'utf8'));
const steps = workflow.jobs.simulator.steps;

describe('pinned native archive reuse', () => {
  it('accepts a successful manual main build whose unexpired artifact and source are contained in main', () => {
    expect(validatePinnedRun(String(runId), run, jobs, artifacts)).toEqual({ runId, source, artifactName: artifact.name });
    expect(validatePinnedRun(String(runId), run, jobs, artifacts, { ...comparison, status: 'identical' })).toEqual({ runId, source, artifactName: artifact.name });
    expect(() => validateReuse({ runId, source }, manifest, result, archiveSha256, '1.2.0')).not.toThrow();
  });
  it.each(['', '0', '-1', '12a', '1 2', '123456789012345678901', '$(id)', '41054807810\n1'])('rejects malformed run id %j', id => {
    expect(() => parseRunId(id)).toThrow();
  });
  it.each([
    ['event', 'pull_request'], ['head_branch', 'unreviewed'], ['id', 123], ['status', 'in_progress'],
    ['path', '.github/workflows/other.yml'], ['repository', { full_name: 'attacker/fork' }],
    ['head_repository', { full_name: 'attacker/fork' }], ['head_sha', 'not-a-sha'],
  ])('rejects untrusted run metadata %s', (key, value) => {
    expect(() => validatePinnedRun(String(runId), { ...run, [key]: value }, jobs, artifacts)).toThrow();
  });
  it.each([
    ['missing', { total_count: 0, artifacts: [] }],
    ['expired', { total_count: 1, artifacts: [{ ...artifact, expired: true }] }],
    ['renamed', { total_count: 1, artifacts: [{ ...artifact, name: 'ios-simulator-qa-other' }] }],
    ['other run', { total_count: 1, artifacts: [{ ...artifact, workflow_run: { id: 1, head_sha: source } }] }],
    ['other sha', { total_count: 1, artifacts: [{ ...artifact, workflow_run: { id: runId, head_sha: 'f'.repeat(40) } }] }],
    ['duplicate', { total_count: 2, artifacts: [artifact, artifact] }],
  ])('rejects a %s artifact before download', (_, list) => {
    expect(() => validatePinnedRun(String(runId), run, jobs, list)).toThrow();
  });
  it.each([['behind'], ['diverged']])('rejects a build source not contained in current main (%s)', status => {
    expect(() => validatePinnedRun(String(runId), run, jobs, artifacts, { ...comparison, status })).toThrow();
    expect(() => validatePinnedRun(String(runId), run, jobs, artifacts, { ...comparison, merge_base: 'f'.repeat(40) })).toThrow();
  });
  it('rejects changed bytes, failed native build, debug, architecture, version and transport drift', () => {
    expect(() => validateReuse({ runId, source }, manifest, result, 'different', '1.2.0')).toThrow();
    expect(() => validatePinnedRun(String(runId), run, { jobs: [] }, artifacts)).toThrow();
    expect(() => validateReuse({ runId, source }, manifest, { exitCode: 1 }, archiveSha256, '1.2.0')).toThrow();
    expect(() => validateReuse({ runId, source }, manifest, result, archiveSha256, '1.3.0')).toThrow();
    for (const patch of [{ configuration: 'Debug' }, { binaryArchitectures: ['x86_64'] }, { productionTransport: false }, { generatedOtaEnabled: true },
      { sentryDsnConfigured: true }, { sourceCommit: 'f'.repeat(40) }, { appArchiveSha256: 'f'.repeat(64) }]) {
      expect(() => validateReuse({ runId, source }, { ...manifest, ...patch }, result, archiveSha256, '1.2.0')).toThrow();
    }
  });
  it('builds fresh by default and validates any pinned run before the only reviewer-secret step', () => {
    expect(JSON.stringify(workflow)).not.toMatch(/41054807810|reuse_reviewed_build/);
    expect(workflow.on.workflow_dispatch.inputs.pinned_run_id).toMatchObject({ type: 'string', default: '' });
    const reuse = steps.findIndex(step => step.name === 'Verify and reuse a pinned native Simulator archive');
    const secret = steps.findIndex(step => step.env?.QA_REVIEWER_PASSWORD);
    expect(reuse).toBeGreaterThan(0);
    expect(reuse).toBeLessThan(secret);
    expect(steps[reuse].if).toBe("inputs.pinned_run_id != ''");
    expect(steps[reuse].env.PINNED_RUN_ID).toBe('${{ inputs.pinned_run_id }}');
    expect(steps[reuse].run).not.toContain('${{');
    expect(steps[reuse].run).toContain('[[ "$CAPTURE_ENABLED" == true ]]');
    expect(steps[reuse].run).not.toContain('secrets.');
    const preflight = steps[reuse].run.indexOf('ios-qa-reuse.mjs preflight');
    expect(preflight).toBeGreaterThan(0);
    expect(preflight).toBeLessThan(steps[reuse].run.indexOf('gh run download'));
    expect(steps.find(step => step.name === 'Build and exercise the native Simulator app').if).toBe("inputs.pinned_run_id == ''");
  });
});
