import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const EAS_CLI_VERSION = '16.28.0';
const EAS_ENVIRONMENT = 'preview';

export const SENTRY_EAS_VARIABLES = [
  { name: 'SENTRY_DSN', visibility: 'sensitive' },
  { name: 'SENTRY_AUTH_TOKEN', visibility: 'secret' },
];

function requireProtectedValue(environment, name) {
  const value = environment[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing protected GitHub environment secret: ${name}.`);
  }
  return value;
}

export function provisionSentryEasEnvironment({
  environment = process.env,
  run = spawnSync,
} = {}) {
  requireProtectedValue(environment, 'EXPO_TOKEN');
  const protectedValues = new Map(SENTRY_EAS_VARIABLES.map((variable) => [
    variable.name,
    requireProtectedValue(environment, variable.name),
  ]));

  const provisioned = [];
  for (const variable of SENTRY_EAS_VARIABLES) {
    const value = protectedValues.get(variable.name);
    const result = run(npx, [
      '--yes',
      `eas-cli@${EAS_CLI_VERSION}`,
      'env:create',
      '--environment',
      EAS_ENVIRONMENT,
      '--scope',
      'project',
      '--name',
      variable.name,
      '--value',
      value,
      '--visibility',
      variable.visibility,
      '--non-interactive',
      '--force',
    ], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: environment,
      stdio: 'pipe',
    });

    if (result.error || result.status !== 0) {
      const exitLabel = Number.isInteger(result.status) ? `exit ${result.status}` : 'no exit code';
      throw new Error(`Failed to provision ${variable.name} in EAS preview (${exitLabel}).`);
    }

    provisioned.push({ ...variable });
  }

  return provisioned;
}

async function main() {
  try {
    const provisioned = provisionSentryEasEnvironment();
    const summary = provisioned
      .map(({ name, visibility }) => `${name} (${visibility.toUpperCase()})`)
      .join(', ');
    process.stdout.write(`Provisioned EAS preview variable metadata: ${summary}.\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'EAS environment provisioning failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
