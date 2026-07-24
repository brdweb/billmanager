import { authSecurityResources } from '../features/authSecurityResources';
import { mobileCoreResources } from '../features/mobileCoreResources';
import { mobileParityResources } from '../features/mobileParityResources';
import { mobileSettingsResources } from '../features/settings/mobileResources';
import { localeCatalogs } from './generated';

type TranslationTree = Readonly<Record<string, unknown>>;

type TranslationCatalog = TranslationTree & {
  readonly _meta: {
    readonly languageName: string;
  };
};

type LocalizedMobileNamespace = {
  readonly en: TranslationTree;
  readonly [language: string]: TranslationTree;
};

type MobileNamespaces = Readonly<Record<string, LocalizedMobileNamespace>>;

export function createI18nResources(
  catalogs: Readonly<Record<string, TranslationCatalog>>,
  mobileNamespaces: MobileNamespaces,
): Record<string, { readonly translation: Record<string, unknown> }> {
  return Object.fromEntries(Object.entries(catalogs).map(([language, catalog]) => {
    const { _meta: metadata, ...shared } = catalog;
    void metadata;
    const mobile = Object.fromEntries(
      Object.entries(mobileNamespaces).map(([namespace, localizedResources]) => [
        namespace,
        localizedResources[language] ?? localizedResources.en,
      ]),
    );
    return [language, { translation: { ...shared, ...mobile } }];
  }));
}

const mobileNamespaces = {
  mobileCore: mobileCoreResources,
  mobileSettings: mobileSettingsResources,
  mobileAuth: {
    en: authSecurityResources.en.auth,
    de: authSecurityResources.de.auth,
  },
  mobileSecurity: {
    en: authSecurityResources.en.security,
    de: authSecurityResources.de.security,
  },
  mobileParity: mobileParityResources,
} satisfies MobileNamespaces;

export const resources = createI18nResources(localeCatalogs, mobileNamespaces);
