import type { Client, ErrorEvent, StackFrame } from '@sentry/core';
import { createReactNativeRewriteFrames } from '@sentry/react-native/dist/js/integrations/rewriteframes';
import { describe, expect, it, vi } from 'vitest';

import { scrubSentryEvent } from './sentryPrivacy';

const platform = vi.hoisted(() => ({ OS: 'android' }));
vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('@sentry/react-native/dist/js/utils/environment', () => ({
  isExpo: () => true,
  isHermesEnabled: () => true,
}));

async function processFrame(frame: StackFrame) {
  const event: ErrorEvent = {
    type: undefined,
    exception: { values: [{ stacktrace: { frames: [frame] } }] },
  };
  const integration = createReactNativeRewriteFrames();
  const rewritten = await integration.processEvent!(event, {}, {} as Client);
  return scrubSentryEvent(rewritten as ErrorEvent).exception?.values?.[0]?.stacktrace?.frames?.[0];
}

describe.each(['android', 'ios'])('patched Sentry frame pipeline on %s', (os) => {
  it.each(['InternalBytecode.js', '/InternalBytecode.js'])(
    'keeps Hermes runtime frame %s out of the application source map',
    async (filename) => {
      platform.OS = os;
      expect(await processFrame({
        filename, abs_path: '/private/PRIVATE_PATH_CANARY', lineno: 1, colno: 907, in_app: true,
      })).toMatchObject({ filename, lineno: 1, colno: 907, in_app: false, abs_path: undefined });
    },
  );

  it('still rewrites application bytecode to the uploaded bundle with one-based columns', async () => {
    platform.OS = os;
    const frame = await processFrame({
      filename: 'file:///private/PRIVATE_PATH_CANARY/index.bundle', lineno: 1, colno: 907,
    });
    expect(frame).toMatchObject({
      filename: os === 'android' ? 'app:///index.android.bundle' : 'app:///main.jsbundle',
      lineno: 1, colno: 908,
    });
    expect(JSON.stringify(frame)).not.toContain('PRIVATE_PATH_CANARY');
  });
});
