import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { parseRunId, prepareReuse, validatePinnedRun, validateReuse } from './ios-qa-reuse.mjs';
const REJECTED = 'Untrusted Simulator archive rejected';
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
    expect(() => parseRunId(id)).toThrow(REJECTED);
  });
  it.each([
    ['event', 'pull_request'], ['head_branch', 'unreviewed'], ['id', 123], ['status', 'in_progress'],
    ['path', '.github/workflows/other.yml'], ['repository', { full_name: 'attacker/fork' }],
    ['head_repository', { full_name: 'attacker/fork' }], ['head_sha', 'not-a-sha'],
  ])('rejects untrusted run metadata %s', (key, value) => {
    expect(() => validatePinnedRun(String(runId), { ...run, [key]: value }, jobs, artifacts)).toThrow(REJECTED);
  });
  it.each([
    ['missing', { total_count: 0, artifacts: [] }],
    ['expired', { total_count: 1, artifacts: [{ ...artifact, expired: true }] }],
    ['renamed', { total_count: 1, artifacts: [{ ...artifact, name: 'ios-simulator-qa-other' }] }],
    ['other run', { total_count: 1, artifacts: [{ ...artifact, workflow_run: { id: 1, head_sha: source } }] }],
    ['other sha', { total_count: 1, artifacts: [{ ...artifact, workflow_run: { id: runId, head_sha: 'f'.repeat(40) } }] }],
    ['duplicate', { total_count: 2, artifacts: [artifact, artifact] }],
  ])('rejects a %s artifact before download', (_, list) => {
    expect(() => validatePinnedRun(String(runId), run, jobs, list)).toThrow(REJECTED);
  });
  it.each([
    ['null run', [null, jobs, artifacts]], ['null jobs', [run, null, artifacts]], ['null artifacts', [run, jobs, null]],
    ['over-limit listing', [run, jobs, { ...artifacts, total_count: 101 }]],
    ['null comparison', [run, jobs, artifacts, null]],
    ['mismatched comparison base', [run, jobs, artifacts, { ...comparison, base: 'f'.repeat(40) }]],
  ])('rejects %s with the archive rejection, not a crash', (_, args) => {
    expect(() => validatePinnedRun(String(runId), ...args)).toThrow(REJECTED);
  });
  it.each([['behind'], ['diverged']])('rejects a build source not contained in current main (%s)', status => {
    expect(() => validatePinnedRun(String(runId), run, jobs, artifacts, { ...comparison, status })).toThrow(REJECTED);
    expect(() => validatePinnedRun(String(runId), run, jobs, artifacts, { ...comparison, merge_base: 'f'.repeat(40) })).toThrow(REJECTED);
  });
  it('rejects changed bytes, failed native build, debug, architecture, version and transport drift', () => {
    expect(() => validateReuse({ runId, source }, manifest, result, 'different', '1.2.0')).toThrow(REJECTED);
    expect(() => validatePinnedRun(String(runId), run, { jobs: [] }, artifacts)).toThrow(REJECTED);
    expect(() => validateReuse({ runId, source }, manifest, { exitCode: 1 }, archiveSha256, '1.2.0')).toThrow(REJECTED);
    expect(() => validateReuse({ runId, source }, manifest, result, archiveSha256, '1.3.0')).toThrow(REJECTED);
    for (const patch of [{ configuration: 'Debug' }, { binaryArchitectures: ['x86_64'] }, { productionTransport: false }, { generatedOtaEnabled: true },
      { sentryDsnConfigured: true }, { sourceCommit: 'f'.repeat(40) }, { appArchiveSha256: 'f'.repeat(64) }]) {
      expect(() => validateReuse({ runId, source }, { ...manifest, ...patch }, result, archiveSha256, '1.2.0')).toThrow(REJECTED);
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
  it('rechecks containment in current main before the artifact download', () => {
    const run = steps.find(step => step.name === 'Verify and reuse a pinned native Simulator archive').run;
    const compare = run.indexOf('/compare/'), contained = run.indexOf('ios-qa-reuse.mjs contained'), download = run.indexOf('gh run download');
    expect(compare).toBeGreaterThan(0);
    expect(contained).toBeGreaterThan(compare);
    expect(contained).toBeLessThan(download);
    expect(run.slice(contained - 200, contained + 100)).toContain('== "$source_sha" ]]');
  });
});

describe('pinned archive CLI and prepareReuse wiring', () => {
  const script = fileURLToPath(new URL('./ios-qa-reuse.mjs', import.meta.url));
  const mobileVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'ios-qa-reuse-'));
    const metadata = join(root, 'metadata'), incoming = join(root, 'incoming'); mkdirSync(metadata); mkdirSync(incoming);
    const write = (dir, name, value) => writeFileSync(join(dir, name), JSON.stringify(value));
    write(metadata, 'run.json', run); write(metadata, 'jobs.json', jobs); write(metadata, 'artifacts.json', artifacts);
    const zip = Buffer.from('synthetic archive bytes');
    writeFileSync(join(incoming, 'BillManager-simulator.app.zip'), zip);
    write(incoming, 'manifest.json', { ...manifest, mobileVersion, appArchiveSha256: createHash('sha256').update(zip).digest('hex') });
    write(incoming, 'result.json', result);
    return { root, metadata, incoming };
  };
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  it('prints only the source commit for preflight and contained checks, and fails closed without containment', () => {
    const { root, metadata } = fixture();
    try {
      expect(cli('preflight', metadata, String(runId))).toMatchObject({ status: 0, stdout: `${source}\n` });
      expect(cli('contained', metadata, String(runId))).toMatchObject({ status: 1, stdout: '' });
      writeFileSync(join(metadata, 'comparison.json'), JSON.stringify({ ...comparison, status: 'behind' }));
      expect(cli('contained', metadata, String(runId))).toMatchObject({ status: 1, stdout: '' });
      writeFileSync(join(metadata, 'comparison.json'), JSON.stringify(comparison));
      expect(cli('contained', metadata, String(runId))).toMatchObject({ status: 0, stdout: `${source}\n` });
      expect(cli('preflight', metadata, '41054807810; id')).toMatchObject({ status: 1, stdout: '' });
    } finally { rmSync(root, { recursive: true }); }
  });
  it('validates metadata, containment and manifest before the first native extraction command', () => {
    const { root, metadata, incoming } = fixture();
    writeFileSync(join(metadata, 'comparison.json'), JSON.stringify(comparison));
    const calls = [];
    const exec = command => { calls.push(command); throw new Error('stop at native extraction'); };
    try {
      expect(() => prepareReuse(metadata, incoming, String(runId), root, exec)).toThrow('stop at native extraction');
      expect(calls).toEqual(['ditto']);
      calls.length = 0;
      writeFileSync(join(metadata, 'comparison.json'), JSON.stringify({ ...comparison, merge_base: 'f'.repeat(40) }));
      expect(() => prepareReuse(metadata, incoming, String(runId), root, exec)).toThrow(REJECTED);
      writeFileSync(join(metadata, 'comparison.json'), JSON.stringify(comparison));
      writeFileSync(join(incoming, 'BillManager-simulator.app.zip'), 'tampered');
      expect(() => prepareReuse(metadata, incoming, String(runId), root, exec)).toThrow(REJECTED);
      expect(calls).toEqual([]);
    } finally { rmSync(root, { recursive: true }); }
  });
});
