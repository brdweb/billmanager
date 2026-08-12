import { normalizeServerUrl } from '../../api/serverUrl';
import { CLOUD_API_BASE_URL } from '../../domain/serverProfile';

export type NativeGoogleSignInResult =
  | { status: 'success'; idToken: string }
  | { status: 'cancelled' };

export interface NativeGoogleSignInAdapter {
  isAvailable(): Promise<boolean>;
  signIn(serverClientId: string, nonce: string): Promise<NativeGoogleSignInResult>;
}

export class NativeGoogleSignInUnavailableError extends Error {
  constructor(
    message = 'Google sign-in requires the BillManager Android credential adapter, which is not available in this build.',
  ) {
    super(message);
    this.name = 'NativeGoogleSignInUnavailableError';
  }
}

interface NativeGoogleModule {
  signInWithGoogle?: (serverClientId: string, nonce: string) => Promise<string>;
}

type NativeGoogleModuleWithGoogleSignIn = Required<NativeGoogleModule>;

type NativeGoogleModuleLoader = () => Promise<NativeGoogleModule | null>;

const loadBundledGoogleModule: NativeGoogleModuleLoader = async () => {
  const imported = await import('../../../modules/billmanager-passkeys/src/BillManagerPasskeysModule');
  return imported.default;
};

export function createNativeGoogleSignInAdapter(
  loadModule: NativeGoogleModuleLoader = loadBundledGoogleModule,
): NativeGoogleSignInAdapter {
  const supportsGoogleSignIn = (
    module: NativeGoogleModule | null,
  ): module is NativeGoogleModuleWithGoogleSignIn => (
    typeof module?.signInWithGoogle === 'function'
  );

  const requireModule = async (): Promise<NativeGoogleModuleWithGoogleSignIn> => {
    try {
      const module = await loadModule();
      if (supportsGoogleSignIn(module)) return module;
    } catch {
      // The module is intentionally absent in Expo Go, web, and iOS builds.
    }
    throw new NativeGoogleSignInUnavailableError();
  };

  return {
    isAvailable: async () => {
      try {
        return supportsGoogleSignIn(await loadModule());
      } catch {
        return false;
      }
    },
    signIn: async (serverClientId, nonce) => {
      const module = await requireModule();
      let idToken: string;
      try {
        idToken = await module.signInWithGoogle(serverClientId, nonce);
      } catch (error) {
        const code = (error as { code?: unknown })?.code;
        if (
          code === 'ERR_GOOGLE_SIGN_IN_CANCELLED'
          || code === 'ERR_GOOGLE_SIGN_IN_UNAVAILABLE'
        ) {
          return { status: 'cancelled' };
        }
        throw error;
      }
      if (!idToken) {
        throw new Error('Google sign-in returned an empty ID token.');
      }
      return { status: 'success', idToken };
    },
  };
}

export const nativeGoogleSignInAdapter = createNativeGoogleSignInAdapter();

export function shouldUseNativeGoogleSignIn(
  providerId: string,
  apiBaseUrl: string,
  platform: string,
): boolean {
  if (platform !== 'android' || providerId !== 'google') return false;
  try {
    return normalizeServerUrl(apiBaseUrl) === CLOUD_API_BASE_URL;
  } catch {
    return false;
  }
}
