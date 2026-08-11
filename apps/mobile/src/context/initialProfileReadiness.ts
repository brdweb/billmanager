import type { PersistedServerProfile } from '../domain/serverProfile';

/**
 * A fresh profile has no capability envelope to drive pre-authentication UI.
 * Keep the startup surface up until the first live verification completes so
 * SSO, registration, and passkey choices do not silently disappear.
 */
export function shouldDeferInitialReady(
  profile: Pick<PersistedServerProfile, 'capabilities'>,
): boolean {
  return profile.capabilities === null;
}
