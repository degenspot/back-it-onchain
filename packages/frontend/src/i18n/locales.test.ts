import { describe, it, expect } from 'vitest';
import { LOCALES, LOCALE_LABELS, DEFAULT_LOCALE, directionFor, isLocale } from './locales';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import de from '../../messages/de.json';
import ja from '../../messages/ja.json';
import zh from '../../messages/zh.json';
import ar from '../../messages/ar.json';

type Json = Record<string, unknown>;

/** Flattens a message catalogue to dotted key paths. */
function flatten(obj: Json, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' ? flatten(value as Json, path) : [path];
  });
}

const catalogues: Record<string, Json> = { en, es, de, ja, zh, ar };

describe('locale registry', () => {
  it('ships the five locales the product requires', () => {
    for (const required of ['en', 'es', 'ja', 'zh', 'ar']) {
      expect(LOCALES).toContain(required);
    }
  });

  it('defaults to English', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('labels every locale in its own script', () => {
    for (const code of LOCALES) {
      expect(LOCALE_LABELS[code], `no label for ${code}`).toBeTruthy();
    }
    expect(LOCALE_LABELS.ar).toBe('العربية');
    expect(LOCALE_LABELS.ja).toBe('日本語');
  });

  it('marks Arabic as right-to-left and everything else left-to-right', () => {
    expect(directionFor('ar')).toBe('rtl');
    for (const code of LOCALES.filter((l) => l !== 'ar')) {
      expect(directionFor(code), `${code} should be ltr`).toBe('ltr');
    }
  });

  it('treats an unknown locale as left-to-right rather than throwing', () => {
    expect(directionFor('klingon')).toBe('ltr');
    expect(isLocale('klingon')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale('ar')).toBe(true);
  });
});

describe('translation coverage', () => {
  const enKeys = flatten(en as Json).sort();

  it('every locale has exactly the English key set', () => {
    for (const [code, catalogue] of Object.entries(catalogues)) {
      const keys = flatten(catalogue).sort();
      expect(keys, `${code} keys diverge from en`).toEqual(enKeys);
    }
  });

  it('no locale ships an empty string for a translated key', () => {
    for (const [code, catalogue] of Object.entries(catalogues)) {
      const walk = (obj: Json, prefix = ''): void => {
        for (const [key, value] of Object.entries(obj)) {
          const path = prefix ? `${prefix}.${key}` : key;
          if (value && typeof value === 'object') {
            walk(value as Json, path);
          } else {
            expect(String(value).trim(), `${code}.${path} is empty`).not.toBe('');
          }
        }
      };
      walk(catalogue);
    }
  });

  it('actually translates rather than copying English through', () => {
    // The brand name is intentionally identical everywhere, so compare a
    // string that must change: the navigation "home" label.
    const homeLabels = Object.entries(catalogues).map(
      ([code, c]) => [code, (c.Nav as Json).home] as const,
    );
    const english = homeLabels.find(([c]) => c === 'en')![1];
    for (const [code, label] of homeLabels) {
      if (code === 'en') continue;
      expect(label, `${code} left Nav.home untranslated`).not.toBe(english);
    }
  });
});
