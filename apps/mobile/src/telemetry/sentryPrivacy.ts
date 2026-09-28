import type {
  ErrorEvent,
  Exception,
  ReactNativeOptions,
  StackFrame,
  Stacktrace,
  Thread,
} from '@sentry/react-native';

const REDACTED = '[redacted]';
const SAFE_TYPE = /^[A-Za-z_$][A-Za-z0-9_.$:-]{0,119}$/;
type BeforeSendHint = Parameters<NonNullable<ReactNativeOptions['beforeSend']>>[1];

export interface SentryRuntimeIdentity {
  dsn: string;
  releaseVersion: string;
  nativeBuildVersion: string;
  platform: 'android' | 'ios' | 'web';
  environment: string;
}

function safeType(value: string | undefined, fallback: string): string {
  return value && SAFE_TYPE.test(value) ? value : fallback;
}

function withoutUrlData(value: string | undefined): string | undefined {
  if (!value) return value;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return '[redacted-url]';
  return value.replace(/[?#].*$/, '');
}

function scrubFrame(frame: StackFrame): StackFrame {
  return {
    filename: withoutUrlData(frame.filename),
    function: frame.function,
    module: frame.module,
    lineno: frame.lineno,
    colno: frame.colno,
    abs_path: withoutUrlData(frame.abs_path),
    in_app: frame.in_app,
    platform: frame.platform,
    instruction_addr: frame.instruction_addr,
    addr_mode: frame.addr_mode,
    debug_id: frame.debug_id,
  };
}

function scrubStacktrace(stacktrace: Stacktrace | undefined): Stacktrace | undefined {
  if (!stacktrace) return undefined;
  return {
    frames: stacktrace.frames?.map(scrubFrame),
    frames_omitted: stacktrace.frames_omitted,
  };
}

function scrubException(exception: Exception): Exception {
  const mechanism = exception.mechanism;
  return {
    type: safeType(exception.type, 'Error'),
    value: REDACTED,
    thread_id: exception.thread_id,
    stacktrace: scrubStacktrace(exception.stacktrace),
    mechanism: mechanism
      ? {
          type: safeType(mechanism.type, 'generic'),
          handled: mechanism.handled,
          synthetic: mechanism.synthetic,
          exception_id: mechanism.exception_id,
          parent_id: mechanism.parent_id,
          is_exception_group: mechanism.is_exception_group,
        }
      : undefined,
  };
}

function scrubThread(thread: Thread): Thread {
  return {
    id: thread.id,
    current: thread.current,
    crashed: thread.crashed,
    main: thread.main,
    stacktrace: scrubStacktrace(thread.stacktrace),
  };
}

/**
 * Build an allowlisted event rather than trying to enumerate sensitive keys.
 * Stack frames and debug images are retained for symbolication; user/runtime
 * context, requests, URLs, messages, breadcrumbs, tags and arbitrary data are
 * deliberately omitted.
 */
export function scrubSentryEvent(event: ErrorEvent, hint?: BeforeSendHint): ErrorEvent {
  if (hint?.attachments) hint.attachments = [];

  return {
    event_id: event.event_id,
    message: event.message === undefined ? undefined : REDACTED,
    logentry: event.logentry === undefined ? undefined : { message: REDACTED },
    timestamp: event.timestamp,
    level: event.level,
    platform: event.platform,
    release: event.release,
    dist: event.dist,
    environment: event.environment,
    type: undefined,
    sdk: event.sdk,
    modules: event.modules,
    debug_meta: event.debug_meta,
    exception: event.exception?.values
      ? { values: event.exception.values.map(scrubException) }
      : undefined,
    threads: event.threads?.values
      ? { values: event.threads.values.map(scrubThread) }
      : undefined,
  };
}

export function sentryRelease(releaseVersion: string): string {
  const normalized = releaseVersion.trim();
  if (!normalized || !/^[0-9A-Za-z.+-]+$/.test(normalized)) {
    throw new Error('Mobile Sentry release version is invalid.');
  }
  return `mobile-v${normalized}`;
}

export function sentryDist(platform: SentryRuntimeIdentity['platform'], build: string): string {
  const normalized = build.trim();
  if (!normalized || !/^[0-9A-Za-z._-]+$/.test(normalized)) {
    throw new Error('Mobile Sentry build identity is invalid.');
  }
  return `${platform}-${normalized}`;
}

export function createSentryOptions(identity: SentryRuntimeIdentity): ReactNativeOptions {
  return {
    dsn: identity.dsn,
    release: sentryRelease(identity.releaseVersion),
    dist: sentryDist(identity.platform, identity.nativeBuildVersion),
    environment: safeType(identity.environment, 'production'),
    sendDefaultPii: false,
    sampleRate: 1,
    enableAutoSessionTracking: true,
    enableNative: identity.platform !== 'web',
    enableNativeCrashHandling: identity.platform !== 'web',
    enableNdkScopeSync: false,
    attachThreads: false,
    attachStacktrace: true,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableCaptureFailedRequests: false,
    enableAutoPerformanceTracing: false,
    enableAppStartTracking: false,
    enableNativeFramesTracking: false,
    enableStallTracking: false,
    enableUserInteractionTracing: false,
    enableWatchdogTerminationTracking: false,
    enableAppHangTracking: false,
    enableLogs: false,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    tracePropagationTargets: [],
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: scrubSentryEvent,
    beforeScreenshot: () => false,
  };
}
