const { withGradleProperties } = require('@expo/config-plugins');

const COMMENT =
  'EAS medium workers have 4 vCPU and about 16 GB, and the build image forces Gradle to run parallel. Cap the worker count, and compile Kotlin inside the Gradle JVM, so a second compiler process cannot stack on the 4 GB Gradle heap.';

const MEMORY_PROPERTIES = [
  ['org.gradle.workers.max', '2'],
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
 * The release build also runs several Ninja compiles. EAS still sets
 * org.gradle.parallel=true on the command line, which overrides
 * gradle.properties, so the worker cap is the limit that actually applies.
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
