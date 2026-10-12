import { pathToFileURL } from 'node:url';

const API = 'https://sentry.io/api/0/';
const PROJECT = 'projects/jason-mitchell/billmanager-mobile/';
const EVENT_ID = /^[0-9a-f]{32}$/i;
const VERSION = /^mobile-v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const REDACTED = new Set(['[redacted]', '[Removed for privacy]', '[Filtered]', '']);

function present(value) {
  return value != null && (typeof value !== 'object' || Object.keys(value).length > 0);
}

/** Return counts/booleans only; never log event text, users, paths or arbitrary metadata. */
export function summarizeEvent(event) {
  const entries = Array.isArray(event.entries) ? event.entries : [];
  const entry = (type) => entries.find((item) => item.type === type)?.data;
  const exceptions = entry('exception')?.values ?? event.exception?.values ?? [];
  const threads = entry('threads')?.values ?? event.threads?.values ?? [];
  const stacks = [...exceptions, ...threads].flatMap((item) => item.stacktrace ? [item.stacktrace] : []);
  const frames = stacks.flatMap((stack) => stack.frames ?? []);
  const images = entry('debugmeta')?.images ?? event.debug_meta?.images ?? [];
  const release = typeof event.release === 'string' ? event.release : event.release?.version;
  const id = event.eventID ?? event.event_id;
  const platform = ['javascript', 'native', 'java', 'cocoa'].includes(event.platform) ? event.platform : 'other';
  return {
    eventId: typeof id === 'string' && EVENT_ID.test(id) ? id : null,
    platform,
    release: typeof release === 'string' && VERSION.test(release) ? release : null,
    exceptionCount: exceptions.length,
    frameCount: frames.length,
    sourceMappedTestFrame: frames.some((frame) =>
      /(?:^|\/)src\/telemetry\/sentryTestCrash\.ts$/.test(frame.filename ?? frame.absPath ?? '')
      && frame.function === 'triggerSentryJavaScriptTestError'),
    runtimeFrames: frames.filter((frame) =>
      ['InternalBytecode.js', '/InternalBytecode.js', 'native', '[native code]'].includes(frame.filename)).length,
    namedNativeFrames: frames.filter((frame) =>
      (frame.instructionAddr || frame.instruction_addr)
      && typeof frame.function === 'string' && !['?', '<unknown>'].includes(frame.function)).length,
    nativeTestSymbolFound: frames.some((frame) =>
      /(?:sendSignal|tgkill|raise|abort|RNSentryModuleImpl.*crash)/.test(frame.function ?? '')),
    imageCount: images.length,
    imagesWithDebugId: images.filter((image) => Boolean(image.debug_id ?? image.debugId ?? image.uuid)).length,
    imagesWithMissingCodeFile: images.filter((image) =>
      ['elf', 'macho'].includes(image.type) && !(image.code_file ?? image.codeFile)).length,
    processingErrorCount: Array.isArray(event.errors) ? event.errors.length : 0,
    privacy: {
      hasUser: present(event.user),
      hasRequest: present(event.request) || present(entry('request')),
      hasBreadcrumbs: (entry('breadcrumbs')?.values ?? event.breadcrumbs?.values ?? []).length > 0,
      hasExtra: present(event.extra) || present(event.context),
      hasRegisters: stacks.some((stack) => present(stack.registers)),
      hasFrameVariables: frames.some((frame) => present(frame.vars)),
      hasUnredactedExceptionValue: exceptions.some((exception) =>
        typeof exception.value === 'string' && !REDACTED.has(exception.value)),
    },
  };
}

export async function inspectSentryEvents({ token = process.env.SENTRY_AUTH_TOKEN, fetchImpl = fetch } = {}) {
  if (!token) throw new Error('SENTRY_AUTH_TOKEN is required.');
  async function get(path) {
    let response;
    try {
      response = await fetchImpl(new URL(path, API), {
        method: 'GET', redirect: 'error',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error('Sentry read-only request failed; response details suppressed.');
    }
    if (!response.ok) throw new Error(`Sentry read-only request returned HTTP ${response.status}.`);
    try { return await response.json(); } catch { throw new Error('Sentry returned an invalid JSON response.'); }
  }

  const project = await get(PROJECT);
  const events = await get(`${PROJECT}events/?statsPeriod=14d&per_page=20`);
  if (!Array.isArray(events)) throw new Error('Unexpected Sentry event-list shape.');
  const summaries = [];
  for (const event of events) {
    const id = event.eventID ?? event.event_id;
    if (typeof id !== 'string' || !EVENT_ID.test(id)) continue;
    summaries.push(summarizeEvent(await get(`${PROJECT}events/${id}/`)));
  }
  let sessions = { available: false };
  if (/^\d+$/.test(String(project.id))) {
    try {
      const result = await get(`organizations/jason-mitchell/sessions/?project=${project.id}&field=sum(session)&statsPeriod=14d`);
      const count = result.groups?.reduce((total, group) => total + (Number(group.totals?.['sum(session)']) || 0), 0);
      sessions = { available: true, count: Number.isFinite(count) ? count : null };
    } catch {
      // The event token may not have access to release-health aggregates.
      sessions = { available: false };
    }
  }
  return { project: 'billmanager-mobile', window: '14d', maximumEvents: 20, events: summaries, sessions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await inspectSentryEvents(), null, 2));
  } catch (error) {
    // Only locally generated errors are emitted; never echo HTTP bodies or SDK errors.
    console.error(error instanceof Error ? error.message : 'Sentry inspection failed.');
    process.exitCode = 1;
  }
}
