import { describe, expect, it, vi } from 'vitest';
import { inspectSentryEvents, summarizeEvent } from './inspect-sentry-events.mjs';

describe('read-only Sentry evidence', () => {
  it('reports useful evidence without exposing event payloads', () => {
    const secret = 'PRIVATE_TOKEN_CANARY';
    const result = summarizeEvent({
      eventID: secret, platform: secret, release: secret,
      user: { email: secret }, request: { url: secret }, extra: { token: secret },
      entries: [{ type: 'exception', data: { values: [{
        value: secret,
        stacktrace: { registers: { x0: secret }, frames: [{
          filename: 'src/telemetry/sentryTestCrash.ts', function: 'triggerSentryJavaScriptTestError',
          vars: { token: secret },
        }] },
      }] } }],
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.sourceMappedTestFrame).toBe(true);
    expect(result.privacy).toMatchObject({ hasUser: true, hasRequest: true, hasRegisters: true, hasUnredactedExceptionValue: true });
  });

  it('uses GET on the fixed Sentry origin and never follows redirects', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ id: '42' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ groups: [{ totals: { 'sum(session)': 2 } }] }) });
    expect(await inspectSentryEvents({ token: 'synthetic-token', fetchImpl })).toMatchObject({ events: [], sessions: { available: true, count: 2 } });
    for (const [url, options] of fetchImpl.mock.calls) {
      expect(url.origin).toBe('https://sentry.io');
      expect(options).toMatchObject({ method: 'GET', redirect: 'error' });
    }
  });

  it('does not disclose error bodies or network exceptions', async () => {
    await expect(inspectSentryEvents({ token: 'synthetic-token', fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'PRIVATE_TOKEN_CANARY' }) }))
      .rejects.toThrow('Sentry read-only request returned HTTP 403.');
    await expect(inspectSentryEvents({ token: 'synthetic-token', fetchImpl: async () => { throw new Error('PRIVATE_TOKEN_CANARY'); } }))
      .rejects.toThrow('Sentry read-only request failed; response details suppressed.');
  });
});
