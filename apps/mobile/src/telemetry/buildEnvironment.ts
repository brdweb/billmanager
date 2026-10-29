type BuildEnvironment = 'development' | 'preview' | 'production';

function isBuildEnvironment(value: unknown): value is BuildEnvironment {
  return value === 'development' || value === 'preview' || value === 'production';
}

/** A release's environment must not depend on an enabled OTA controller. */
export function resolveBuildEnvironment(embedded: unknown, updateChannel: unknown, development: boolean): BuildEnvironment {
  if (development) return 'development';
  if (isBuildEnvironment(embedded)) return embedded;
  if (isBuildEnvironment(updateChannel)) return updateChannel;
  return 'production';
}
