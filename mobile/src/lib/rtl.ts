import { reloadAppAsync } from 'expo';
import { I18nManager, Platform } from 'react-native';

import type { Language } from './types';

/**
 * Hebrew is right-to-left; English and French are left-to-right. React Native applies a direction
 * change only after a reload, so call this after the language changes. Returns true if the app is
 * reloading.
 */
export async function applyDirection(lang: Language): Promise<boolean> {
  const rtl = lang === 'he';
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      document.documentElement.dir = rtl ? 'rtl' : 'ltr';
      document.documentElement.lang = lang;
    }
    return false;
  }
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.forceRTL(rtl);
  I18nManager.swapLeftAndRightInRTL(true);
  await reloadAppAsync();
  return true;
}
