import { chmodSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MARKER = 'billmanager-native-job-cap';
const JOBS = '1';

function sdkRoots(argv = process.argv) {
  const rootFlag = argv.indexOf('--sdk-root');
  if (rootFlag !== -1 && argv[rootFlag + 1]) {
    return [argv[rootFlag + 1]];
  }
  const home = process.env.HOME || '';
  return [...new Set([
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    home ? path.join(home, 'Android/Sdk') : '',
    home ? path.join(home, 'android-sdk') : '',
    '/home/expo/Android/Sdk',
    '/opt/android-sdk',
  ].filter(Boolean))];
}

function cmakeNinjaCandidates(root) {
  const cmakeRoot = path.join(root, 'cmake');
  if (!existsSync(cmakeRoot)) return [];
  return [cmakeRoot];
}

function findNinjas(root) {
  const found = [];
  for (const cmakeRoot of cmakeNinjaCandidates(root)) {
    let versions = [];
    try {
      versions = readdirSync(cmakeRoot);
    } catch {
      continue;
    }
    for (const version of versions) {
      const ninja = path.join(cmakeRoot, version, 'bin', 'ninja');
      try {
        if (statSync(ninja).isFile()) found.push(ninja);
      } catch {
        // A cmake version without ninja is not a build tool we have to cap.
      }
    }
  }
  return found;
}

function wrapperScript() {
  return `#!/bin/sh
# ${MARKER}
# The Android Gradle Plugin runs ninja without -j, so ninja uses nproc+2.
# Several of those overlap with the Gradle heap on the 16 GB EAS worker.
jobs=${JOBS}
for arg in "$@"; do
  case "$arg" in
    -j|--jobs|-j*) jobs= ;;
  esac
done
if [ -n "$jobs" ]; then
  exec "$0.real" -j "$jobs" "$@"
else
  exec "$0.real" "$@"
fi
`;
}

function wrapNinja(ninjaPath) {
  const header = readFileSync(ninjaPath).subarray(0, 256).toString('utf8');
  const realPath = `${ninjaPath}.real`;
  if (header.includes(MARKER)) {
    if (!existsSync(realPath)) throw new Error('Native job wrapper has no original binary');
    // Cached SDKs can retain an older cap; update only our marked wrapper.
    writeFileSync(ninjaPath, wrapperScript(), { mode: 0o755 });
    chmodSync(ninjaPath, 0o755);
    return 'already-capped';
  }
  if (existsSync(realPath)) return 'real-binary-already-present';
  renameSync(ninjaPath, realPath);
  writeFileSync(ninjaPath, wrapperScript(), { mode: 0o755 });
  chmodSync(ninjaPath, 0o755);
  return 'capped';
}

function restoreNinja(ninjaPath) {
  const header = readFileSync(ninjaPath).subarray(0, 256).toString('utf8');
  const realPath = `${ninjaPath}.real`;
  if (!header.includes(MARKER) || !existsSync(realPath)) return 'unchanged';
  rmSync(ninjaPath);
  renameSync(realPath, ninjaPath);
  return 'restored';
}

function main() {
  const restore = process.argv.includes('--restore');
  const roots = sdkRoots();
  const ninjas = roots.flatMap((root) => findNinjas(root));
  if (ninjas.length === 0) {
    console.log('No Android SDK ninja binary found; native job cap was not changed.');
    return;
  }
  for (const ninja of ninjas) {
    const result = restore ? restoreNinja(ninja) : wrapNinja(ninja);
    console.log(`${result} ${ninja}`);
  }
}

main();
