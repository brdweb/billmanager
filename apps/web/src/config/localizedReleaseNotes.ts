import { releaseNotes, type ReleaseNote } from './releaseNotes';

type ReleaseNotesModule = {
  readonly default: ReleaseNote[];
};

const localizedModules = import.meta.glob<ReleaseNotesModule>('./releaseNotes.*.ts', {
  eager: true,
});

const localizedReleaseNotes = Object.fromEntries(
  Object.entries(localizedModules).flatMap(([modulePath, localeModule]) => {
    const language = modulePath.match(/releaseNotes\.([a-z]{2,3})\.ts$/)?.[1];
    return language ? [[language, localeModule.default] as const] : [];
  })
);

export function getReleaseNotesForLanguage(language: string): ReleaseNote[] {
  const normalized = language.split(/[-_]/, 1)[0]?.toLowerCase() ?? '';
  return localizedReleaseNotes[normalized] ?? releaseNotes;
}

export function getLocalizedReleaseNotes(): Readonly<Record<string, ReleaseNote[]>> {
  return localizedReleaseNotes;
}
