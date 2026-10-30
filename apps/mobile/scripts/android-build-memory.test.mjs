import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const profile = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url)));
describe('Android medium-builder memory budget', () => {
  it('passes one quoted daemon JVM budget and serial limits through Gradle shell parsing', () => {
    const opts = profile.build.production.android.env.GRADLE_OPTS;
    const args = execFileSync('bash', ['-c', 'eval "set -- $GRADLE_OPTS"; printf "%s\\n" "$@"'], {
      env: { ...process.env, GRADLE_OPTS: opts }, encoding: 'utf8',
    }).trim().split('\n');
    expect(args).toEqual([
      '-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=2g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8',
      '-Dorg.gradle.workers.max=1', '-Dorg.gradle.parallel=false', '-Dorg.gradle.daemon=false',
    ]);
    expect(profile.build.production.env).toEqual({ BILLMANAGER_DEVELOPMENT_BUILD: 'false' });
    for (const [name, value] of Object.entries(profile.build)) {
      expect(value.env?.GRADLE_OPTS).toBeUndefined();
      expect(value.ios?.env?.GRADLE_OPTS).toBeUndefined();
      if (name !== 'production') expect(value.android?.env?.GRADLE_OPTS).toBeUndefined();
    }
    expect(profile.build.production.android.buildType).toBe('app-bundle');
  });

  it('replaces existing Gradle properties without adding duplicates on repeated application', () => {
    const module = { exports: {} };
    runInNewContext(readFileSync(new URL('../plugins/withAndroidBuildMemory.js', import.meta.url), 'utf8'), {
      module, require: () => ({ withGradleProperties: (config, action) => action(config) }),
    });
    const config = { modResults: [
      { type: 'property', key: 'org.gradle.workers.max', value: '8' },
      { type: 'property', key: 'org.gradle.parallel', value: 'true' },
      { type: 'property', key: 'unrelated', value: 'keep' },
    ] };
    module.exports(config); module.exports(config);
    for (const [key, value] of [['org.gradle.workers.max', '1'], ['org.gradle.parallel', 'false'], ['kotlin.compiler.execution.strategy', 'in-process']]) {
      expect(config.modResults.filter(p => p.key === key)).toEqual([{ type: 'property', key, value }]);
    }
    expect(config.modResults.find(p => p.key === 'unrelated').value).toBe('keep');
  });

  it('caps actual Ninja execution at one job, preserves explicit limits and restores the binary', () => {
    const root = mkdtempSync(join(tmpdir(), 'android-memory-'));
    const bin = join(root, 'cmake/4/bin'); mkdirSync(bin, { recursive: true });
    const ninja = join(bin, 'ninja');
    writeFileSync(ninja, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    const script = new URL('./limit-android-native-jobs.mjs', import.meta.url);
    try {
      for (let i = 0; i < 2; i++) execFileSync(process.execPath, [script.pathname, '--sdk-root', root]);
      expect(execFileSync(ninja, ['target'], { encoding: 'utf8' })).toBe('-j\n1\ntarget\n');
      writeFileSync(ninja, readFileSync(ninja, 'utf8').replace('jobs=1', 'jobs=2'), { mode: 0o755 });
      expect(execFileSync(ninja, ['target'], { encoding: 'utf8' })).toBe('-j\n2\ntarget\n');
      execFileSync(process.execPath, [script.pathname, '--sdk-root', root]);
      expect(execFileSync(ninja, ['target'], { encoding: 'utf8' })).toBe('-j\n1\ntarget\n');
      expect(execFileSync(ninja, ['-j3', 'target'], { encoding: 'utf8' })).toBe('-j3\ntarget\n');
      execFileSync(process.execPath, [script.pathname, '--sdk-root', root, '--restore']);
      expect(execFileSync(ninja, ['target'], { encoding: 'utf8' })).toBe('target\n');
      const original = readFileSync(ninja, 'utf8');
      writeFileSync(`${ninja}.real`, 'unrelated-original');
      execFileSync(process.execPath, [script.pathname, '--sdk-root', root]);
      expect(readFileSync(ninja, 'utf8')).toBe(original);
      expect(readFileSync(`${ninja}.real`, 'utf8')).toBe('unrelated-original');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
