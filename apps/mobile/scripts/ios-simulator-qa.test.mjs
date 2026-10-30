import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { parse, parseAllDocuments } from 'yaml';

const workflow = parse(readFileSync(new URL('../../../.github/workflows/ios-simulator-qa.yml', import.meta.url), 'utf8'));
const scriptUrl = new URL('./ios-simulator-qa.sh', import.meta.url);
const script = readFileSync(scriptUrl, 'utf8');
const flow = parseAllDocuments(readFileSync(new URL('../.maestro/ios/auth-entry.yaml', import.meta.url), 'utf8'));

describe('credential-free iOS Simulator lane boundaries', () => {
  it('runs only manually from reviewed main on a standard bounded Mac runner', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    const job = workflow.jobs.simulator;
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
    expect(job['runs-on']).toBe('macos-26');
    expect(job['timeout-minutes']).toBe(90);
    expect(JSON.stringify(workflow)).not.toMatch(/eas-cli|workflow_call/);
    expect(workflow.on.workflow_dispatch.inputs.authenticated.default).toBe(false);
    expect(job.environment).toBe("${{ inputs.authenticated && 'ios-production' || '' }}");
    const secretSteps = job.steps.filter(step => JSON.stringify(step).includes('secrets.'));
    expect(secretSteps).toHaveLength(1);
    expect(secretSteps[0].if).toBe('inputs.authenticated');
    expect(secretSteps[0].name).toBe('Capture private synthetic reviewer screens');
    expect(job.steps.find(step => step.uses?.startsWith('actions/upload-artifact')).with.path).not.toMatch(/private|debug|simulator\.log|final-screen/);
    expect(job.steps.find(step => step.uses?.startsWith('actions/upload-artifact')).with['retention-days']).toBe(3);
  });

  it('keeps real native Release code and HTTPS policy while declaring QA exceptions', () => {
    const env = workflow.jobs.simulator.env;
    expect(env.BILLMANAGER_DEVELOPMENT_BUILD).toBe('false');
    expect(env.EXPO_PUBLIC_DESIGN_PREVIEW).toBe('0');
    expect(env.SENTRY_DSN).toBe('');
    expect(env.SENTRY_DISABLE_AUTO_UPLOAD).toBe('true');
    expect(script).toContain('-configuration Release -sdk iphonesimulator');
    expect(script).toContain('CODE_SIGNING_ALLOWED=NO');
    expect(script).toContain('-jobs 2');
    expect(script).toContain('Print :NSAppTransportSecurity:NSAllowsArbitraryLoads');
    expect(script).toContain('Print :NSAppTransportSecurity:NSAllowsLocalNetworking');
    expect(script).toContain('Set :EXUpdatesEnabled false');
    expect(script).toContain("sourceTree: git('rev-parse','HEAD^{tree}')");
    expect(script).toContain('embeddedJavaScriptSha256:hash');
  });

  it('builds and verifies only the active ARM64 Simulator binary and exposes phases', () => {
    expect(script).toContain('ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO');
    expect(script).toContain('Print :CFBundleExecutable');
    expect(script).toContain('xcrun lipo -archs "$app/$executable"');
    expect(script).toContain('[[ "$(cat "$output/binary-architectures.txt")" == arm64 ]]');
    expect(script).toContain("binaryArchitectures:fs.readFileSync(`${output}/binary-architectures.txt`,'utf8')");
    const phases = [...script.matchAll(/QA phase: ([^\\\n']+)/g)].map(match => match[1]);
    expect(phases.map(phase => phase.split(' ')[0])).toEqual(['prebuild', 'pods', 'compile', 'install', 'Maestro']);
  });

  it('captures actual anonymous navigation without credentials or submissions', () => {
    const commands = flow[1].toJS();
    expect(commands[0]).toEqual({ launchApp: { clearState: true } });
    expect(commands.filter(command => command.takeScreenshot).map(command => command.takeScreenshot))
      .toEqual(['auth-login', 'auth-password-recovery']);
    expect(commands.some(command => command.inputText)).toBe(false);
    expect(commands.filter(command => command.tapOn).map(command => command.tapOn.text))
      .toEqual(['Forgot password?', 'Back to sign in']);
    expect(script).toContain('test .maestro/ios/auth-entry.yaml');
    expect(script).toContain('for family in iphone ipad; do');
    expect(script).toContain('node scripts/ios-qa-devices.mjs');
    expect(script.match(/xcodebuild -workspace/g)).toHaveLength(1);
  });

  it('parses the runner shell and embedded evidence scripts before using macOS', () => {
    execFileSync('bash', ['-n', fileURLToPath(scriptUrl)]);
    const blocks = [...script.matchAll(/<<'NODE'\n([\s\S]*?)\nNODE/g)];
    expect(blocks).toHaveLength(1);
    for (const [, source] of blocks) expect(() => new Script(source)).not.toThrow();
  });
});
