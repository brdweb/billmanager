import { NativeModule, requireOptionalNativeModule } from 'expo';

declare class BillManagerPasskeysModule extends NativeModule<Record<string, never>> {
  isSupported(): Promise<boolean>;
  createCredential(optionsJson: string): Promise<string>;
  getCredential(optionsJson: string): Promise<string>;
  signInWithGoogle(serverClientId: string, nonce: string): Promise<string>;
}

export default requireOptionalNativeModule<BillManagerPasskeysModule>('BillManagerPasskeys');
