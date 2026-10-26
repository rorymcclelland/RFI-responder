import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LanguageLabel from './LanguageLabel';

describe('LanguageLabel (Sprint 12, S12-1 test 4)', () => {
  it('labels Japanese entries, and nothing else', () => {
    expect(renderToStaticMarkup(createElement(LanguageLabel, { language: 'ja' }))).toContain('Japanese');
    expect(renderToStaticMarkup(createElement(LanguageLabel, { language: 'en' }))).toBe('');
    expect(renderToStaticMarkup(createElement(LanguageLabel, { language: undefined }))).toBe('');
  });
});
