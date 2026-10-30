import { useContext } from 'react';
import { HeaderShownContext } from '@react-navigation/elements';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { AdaptivePlatform } from './tokens';

/** iOS keeps automatic scroll insets; native-header Android routes already consume the top inset. */
export function useAndroidTopInset(platform: AdaptivePlatform): number {
  const insets = useContext(SafeAreaInsetsContext);
  const headerShown = useContext(HeaderShownContext);
  return platform === 'android' && !headerShown ? Math.max(0, insets?.top ?? 0) : 0;
}
