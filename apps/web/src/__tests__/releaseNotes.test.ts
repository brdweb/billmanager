import { describe, expect, it } from 'vitest';
import { releaseNotes } from '../config/releaseNotes';
import { germanReleaseNotes } from '../config/releaseNotes.de';
import {
  getLocalizedReleaseNotes,
  getReleaseNotesForLanguage,
} from '../config/localizedReleaseNotes';

describe('localized release notes', () => {
  it('keeps German release metadata and content aligned with English', () => {
    expect(germanReleaseNotes.map(({ version, date }) => ({ version, date }))).toEqual(
      releaseNotes.map(({ version, date }) => ({ version, date }))
    );

    expect(germanReleaseNotes.map((release) => release.sections.map((section) => section.items.length))).toEqual(
      releaseNotes.map((release) => release.sections.map((section) => section.items.length))
    );
  });

  it('discovers localized release-note modules and falls back to English', () => {
    expect(getLocalizedReleaseNotes()['de']).toBe(germanReleaseNotes);
    expect(getReleaseNotesForLanguage('de-DE')).toBe(germanReleaseNotes);
    expect(getReleaseNotesForLanguage('fr')).toBe(releaseNotes);
  });
});
