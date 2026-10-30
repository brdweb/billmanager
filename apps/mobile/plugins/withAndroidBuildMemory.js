const { withGradleProperties } = require('@expo/config-plugins');

const COMMENT =
  'EAS medium workers have 4 vCPU and about 16 GB. Serialize Gradle tasks and compile Kotlin inside the Gradle JVM; production Android also overrides the image JVM budget through GRADLE_OPTS.';

const MEMORY_PROPERTIES = [
  ['org.gradle.workers.max', '1'],
  ['org.gradle.parallel', 'false'],
  ['kotlin.compiler.execution.strategy', 'in-process'],
];

function upsertProperty(items, key, value) {
  const existing = items.find((item) => item.type === 'property' && item.key === key);
  if (existing) {
    existing.value = value;
    return;
  }
  items.push({ type: 'property', key, value });
}

/**
 * The production Android profile overrides EAS command-line defaults; these
 * properties provide the same serial task limits for other Android builds.
 * scripts/limit-android-native-jobs.mjs caps each Ninja invocation.
 */
function withAndroidBuildMemory(config) {
  return withGradleProperties(config, (gradleConfig) => {
    const items = gradleConfig.modResults;
    if (!items.some((item) => item.type === 'comment' && item.value === COMMENT)) {
      items.push({ type: 'comment', value: COMMENT });
    }
    for (const [key, value] of MEMORY_PROPERTIES) {
      upsertProperty(items, key, value);
    }
    return gradleConfig;
  });
}

module.exports = withAndroidBuildMemory;
