import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  changeLanguage: vi.fn(),
  init: vi.fn(),
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  use: vi.fn(),
}));

vi.mock('i18next', () => {
  const i18n = {
    changeLanguage: mocks.changeLanguage,
    init: mocks.init,
    use: mocks.use,
  };
  mocks.use.mockReturnValue(i18n);
  return { default: i18n };
});
vi.mock('react-i18next', () => ({ initReactI18next: {} }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
vi.mock('expo-sqlite/kv-store', () => ({
  default: {
    getItem: mocks.storageGet,
    setItem: mocks.storageSet,
  },
}));
vi.mock('./resources', () => ({ resources: {} }));

import { setLanguage } from './index';

describe('language switching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.changeLanguage.mockResolvedValue(undefined);
    mocks.storageSet.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists the selected language when storage succeeds', async () => {
    // Given
    const language = 'de';

    // When
    await setLanguage(language);

    // Then
    expect(mocks.storageSet).toHaveBeenCalledWith('billmanager:language', language);
    expect(mocks.changeLanguage).toHaveBeenCalledWith(language);
  });

  it('changes language and resolves when persistence fails', async () => {
    // Given
    const storageError = new Error('storage unavailable');
    mocks.storageSet.mockRejectedValue(storageError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // When
    const result = setLanguage('de');

    // Then
    await expect(result).resolves.toBeUndefined();
    expect(mocks.changeLanguage).toHaveBeenCalledWith('de');
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to persist language preference:',
      storageError,
    );
  });

  it('rejects when changing the active language fails', async () => {
    // Given
    const languageError = new Error('language switch failed');
    mocks.changeLanguage.mockRejectedValue(languageError);

    // When / Then
    await expect(setLanguage('de')).rejects.toBe(languageError);
  });
});
