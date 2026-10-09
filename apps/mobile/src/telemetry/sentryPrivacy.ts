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

const DEBUG_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})(?:[0-9a-f]{1,8})?$/i;
const ADDRESS = /^0x[0-9a-f]{1,16}$/i;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const BUNDLE_NAME = /^(?:index(?:\.android|\.ios)?\.bundle|main\.jsbundle)$/;
const CODE_SYMBOL = /^[A-Za-z_$~][A-Za-z0-9_$.:<>()[\],*&~+!=%|^-]{0,255}$/;
const OBJC_SYMBOL = /^[-+]\[[A-Za-z_][A-Za-z0-9_]*(?:\([A-Za-z_][A-Za-z0-9_]*\))? [A-Za-z_][A-Za-z0-9_:]*\]$/;

function matching(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function unsignedInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function bundlePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const path = value.replace(/[?#].*$/, '');
  // Only application-owned bundle identities are needed for JS symbolication.
  // Never extract a basename from a URL or host path: that can retain user data.
  if (BUNDLE_NAME.test(path)) return path;
  if (path.startsWith('app:///') && BUNDLE_NAME.test(path.slice(7))) return path;
  return undefined;
}

function codeSymbol(value: unknown): string | undefined {
  const nativeSymbol = matching(value, OBJC_SYMBOL)
    ?? matching(value, /^operator (?:new|delete)(?:\[\])?$/);
  if (nativeSymbol) return nativeSymbol;
  const symbol = matching(value, CODE_SYMBOL);
  // C++ namespace separators are safe; a single colon can introduce a URI scheme.
  return symbol && !/(^|[^:]):([^:]|$)/.test(symbol) ? symbol : undefined;
}

function scrubSdk(sdk: ErrorEvent['sdk']): ErrorEvent['sdk'] {
  if (!sdk) return undefined;
  return {
    name: matching(sdk.name, /^sentry\.(?:javascript(?:\.[a-z-]+)*|cocoa|java(?:\.android)?|native)$/),
    version: matching(sdk.version, VERSION),
    packages: sdk.packages?.flatMap((pkg) => {
      const name = matching(pkg.name, /^(?:npm:@sentry\/[a-z-]+|cocoapods:Sentry|maven:io\.sentry:sentry(?:-android(?:-core|-ndk)?)?)$/);
      const version = matching(pkg.version, VERSION);
      return name && version ? [{ name, version }] : [];
    }),
  };
}

function scrubDebugMeta(meta: ErrorEvent['debug_meta']): ErrorEvent['debug_meta'] {
  if (!meta) return undefined;
  return {
    images: meta.images?.flatMap<NonNullable<NonNullable<ErrorEvent['debug_meta']>['images']>[number]>((image) => {
      const debug_id = matching(image.debug_id, DEBUG_ID);
      if (!debug_id) return [];
      if (image.type === 'macho') {
        const image_addr = matching(image.image_addr, ADDRESS);
        return image_addr ? [{
          type: 'macho' as const,
          debug_id,
          image_addr,
          image_size: unsignedInteger(image.image_size),
          code_file: bundlePath(image.code_file),
        }] : [];
      }
      if (image.type === 'sourcemap' || image.type === 'wasm') {
        // Debug IDs still identify uploaded artifacts when the runtime path is private.
        return [{
          type: image.type,
          debug_id,
          code_file: bundlePath(image.code_file) ?? '[redacted]',
        }];
      }
      return [];
    }),
  };
}

function scrubFrame(frame: StackFrame): StackFrame {
  return {
    filename: bundlePath(frame.filename),
    function: codeSymbol(frame.function),
    module: codeSymbol(frame.module),
    lineno: unsignedInteger(frame.lineno),
    colno: unsignedInteger(frame.colno),
    abs_path: bundlePath(frame.abs_path),
    in_app: typeof frame.in_app === 'boolean' ? frame.in_app : undefined,
    platform: matching(frame.platform, /^(?:javascript|native|cocoa|java|objc|c|cpp|wasm)$/),
    instruction_addr: matching(frame.instruction_addr, ADDRESS),
    addr_mode: matching(frame.addr_mode, /^(?:abs|rel(?::\d+)?)$/),
    debug_id: matching(frame.debug_id, DEBUG_ID),
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
 * Canonical JS bundle names, code symbols, debug IDs and native addresses survive;
 * arbitrary SDK metadata, module maps, image fields and runtime paths do not.
 * User/runtime context, requests, messages, breadcrumbs, tags and data are omitted.
 * Noncanonical paths are omitted, so their source-map association is not retained.
 * A syntactically valid code symbol cannot be distinguished from user data shaped
 * like that symbol; retain only bounded code syntax, never prose.
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
    sdk: scrubSdk(event.sdk),
    // Runtime module maps are arbitrary name/value data, not symbolication inputs.
    modules: undefined,
    debug_meta: scrubDebugMeta(event.debug_meta),
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
