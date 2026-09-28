import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const nativePatch = readFileSync(
  fileURLToPath(new URL('../../patches/@sentry+react-native+7.11.0.patch', import.meta.url)),
  'utf8',
);

describe('mobile Sentry native privacy patch', () => {
  it('scrubs Android native events and attachments before the SDK sends them', () => {
    for (const required of [
      'BillManagerSentryPrivacy.scrub(event, hint);',
      'event.setRequest(null);',
      'event.setUser(null);',
      'event.setBreadcrumbs(null);',
      'event.setExtras(null);',
      'event.setTags(null);',
      'exception.setValue(REDACTED_EVENT_VALUE);',
      'frame.setFilename(null);',
      'frame.setAbsPath(null);',
      'frame.setVars(null);',
      'hint.clearAttachments();',
    ]) {
      expect(nativePatch).toContain(required);
    }
  });

  it('scrubs iOS native events and disables all native attachments and breadcrumbs', () => {
    for (const required of [
      'BillManagerSentryScrubEvent(event);',
      'event.message = nil;',
      'event.request = nil;',
      'event.user = nil;',
      'event.context = nil;',
      'event.breadcrumbs = nil;',
      'exception.value = BillManagerRedactedEventValue;',
      'frame.fileName = nil;',
      'frame.vars = nil;',
      'sentryOptions.maxAttachmentSize = 0;',
      'sentryOptions.maxBreadcrumbs = 0;',
      'return nil;',
    ]) {
      expect(nativePatch).toContain(required);
    }
  });
});
