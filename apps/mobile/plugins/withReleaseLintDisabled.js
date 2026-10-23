const { withAppBuildGradle } = require('@expo/config-plugins');

const LINT_BLOCK = `    lint {
        checkReleaseBuilds false
    }`;

/**
 * The default EAS medium worker (about 16 GB) kills the Gradle daemon while
 * assembleRelease generates a lint-vital model for every library at once.
 * Expo already skips the library analysis; the models exist only because the
 * app runs release lint vital. That lint is not a release gate here.
 */
function withReleaseLintDisabled(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error('Android app/build.gradle must stay Groovy so release lint can be disabled.');
    }
    const contents = gradleConfig.modResults.contents;
    if (contents.includes('checkReleaseBuilds')) {
      return gradleConfig;
    }
    const match = contents.match(/android\s*\{/);
    if (!match) {
      throw new Error('Could not find the android block in app/build.gradle.');
    }
    const insertAt = match.index + match[0].length;
    gradleConfig.modResults.contents = `${contents.slice(0, insertAt)}\n${LINT_BLOCK}${contents.slice(insertAt)}`;
    return gradleConfig;
  });
}

module.exports = withReleaseLintDisabled;
