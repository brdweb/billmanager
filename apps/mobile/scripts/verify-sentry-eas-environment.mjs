import { pathToFileURL } from 'node:url';

const EXPO_GRAPHQL_URL = 'https://api.expo.dev/graphql';
const EAS_PROJECT_ID = '061766ea-b874-4027-bcbb-a24b395cb8b6';
export const REQUIRED_SENTRY_VARIABLES = ['SENTRY_DSN', 'SENTRY_AUTH_TOKEN'];

const SENTRY_METADATA_QUERY = `
  query SentryEnvironmentVariableMetadata(
    $appId: String!
    $filterNames: [String!]
    $environment: EnvironmentVariableEnvironment
  ) {
    app {
      byId(appId: $appId) {
        environmentVariables(filterNames: $filterNames, environment: $environment) {
          name
          visibility
        }
      }
    }
  }
`;

export function verifySentryEasEnvironmentMetadata(variables) {
  const byName = new Map(variables.map((variable) => [variable?.name, variable]));
  const missing = REQUIRED_SENTRY_VARIABLES.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing required EAS environment variable names: ${missing.join(', ')}`);
  }

  if (byName.get('SENTRY_AUTH_TOKEN')?.visibility !== 'SECRET') {
    throw new Error('SENTRY_AUTH_TOKEN must use EAS SECRET visibility.');
  }

  return REQUIRED_SENTRY_VARIABLES.map((name) => ({
    name,
    visibility: byName.get(name)?.visibility,
  }));
}

export async function fetchSentryEasEnvironmentMetadata({
  environment,
  expoToken = process.env.EXPO_TOKEN,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (environment !== 'preview' && environment !== 'production') {
    throw new Error(`Unsupported EAS environment: ${environment}.`);
  }

  if (!expoToken) {
    throw new Error('EXPO_TOKEN is required for the EAS metadata preflight.');
  }

  const response = await fetchImpl(EXPO_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${expoToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: SENTRY_METADATA_QUERY,
      variables: {
        appId: EAS_PROJECT_ID,
        environment,
        filterNames: REQUIRED_SENTRY_VARIABLES,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Expo metadata query failed with HTTP ${response.status}.`);
  }

  const payload = await response.json();
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error('Expo rejected the EAS environment metadata query.');
  }

  const variables = payload.data?.app?.byId?.environmentVariables;
  if (!Array.isArray(variables)) {
    throw new Error('Expo returned malformed EAS environment metadata.');
  }

  return verifySentryEasEnvironmentMetadata(variables);
}

async function main() {
  try {
    const environmentIndex = process.argv.indexOf('--environment', 2);
    const environment = environmentIndex === -1 ? undefined : process.argv[environmentIndex + 1];
    if (!environment || environment.startsWith('--')) {
      throw new Error('Missing required --environment <preview|production> argument.');
    }

    const verified = await fetchSentryEasEnvironmentMetadata({ environment });
    const summary = verified.map(({ name, visibility }) => `${name} (${visibility})`).join(', ');
    process.stdout.write(`Verified EAS ${environment} environment metadata: ${summary}.\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'EAS environment verification failed.';
    console.error(message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
