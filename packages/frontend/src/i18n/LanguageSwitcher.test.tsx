import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import { I18nProvider } from '../../components/I18nProvider';
import en from '../../messages/en.json';
import { LOCALE_LABELS } from './locales';

function renderSwitcher(locale = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={en} timeZone="UTC">
      <LanguageSwitcher />
    </NextIntlClientProvider>,
  );
}

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.dir = 'ltr';
    document.documentElement.lang = 'en';
  });

  it('lists every shipped locale by its endonym', () => {
    renderSwitcher();
    const select = screen.getByRole('combobox', { name: 'Language' });
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);

    expect(options).toEqual([
      LOCALE_LABELS.en,
      LOCALE_LABELS.es,
      LOCALE_LABELS.de,
      LOCALE_LABELS.ja,
      LOCALE_LABELS.zh,
      LOCALE_LABELS.ar,
    ]);
  });

  it('reflects the active locale as the selected option', () => {
    renderSwitcher('ja');
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('ja');
  });

  it('is reachable directly rather than by cycling', () => {
    // Arabic is the last locale; selecting it must not require intermediate
    // steps through the others.
    renderSwitcher('en');
    const select = screen.getByRole('combobox', { name: 'Language' });
    fireEvent.change(select, { target: { value: 'ar' } });
    expect(window.localStorage.getItem('app-locale')).toBe('ar');
  });

  it('persists the choice for the next visit', () => {
    renderSwitcher('en');
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'zh' },
    });
    expect(window.localStorage.getItem('app-locale')).toBe('zh');
  });
});

describe('document direction', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.dir = 'ltr';
    document.documentElement.lang = 'en';
  });

  it('flips the document to RTL when the saved locale is Arabic', async () => {
    window.localStorage.setItem('app-locale', 'ar');

    render(
      <I18nProvider>
        <div>content</div>
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.lang).toBe('ar');
    });
  });

  it('stays LTR for a left-to-right locale', async () => {
    window.localStorage.setItem('app-locale', 'ja');

    render(
      <I18nProvider>
        <div>content</div>
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('ja');
    });
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('switches direction without a reload when the locale changes', async () => {
    render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    );

    await waitFor(() => expect(document.documentElement.dir).toBe('ltr'));

    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'ar' },
    });

    await waitFor(() => {
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.lang).toBe('ar');
    });
  });
});
