import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AppLogo from '@/components/layout/app-logo';

describe('AppLogo', () => {
  it('renders the codexwinmux display name in visible brand text', () => {
    const markup = renderToStaticMarkup(React.createElement(AppLogo));
    const text = markup.replace(/<[^>]+>/g, '');

    expect(text).toContain('windows native codexwinmux');
    expect(text).not.toContain('windows native codexmux');
  });
});
