import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AppLogo from '@/components/layout/app-logo';

describe('AppLogo', () => {
  it('renders the codexmux public display name in visible brand text', () => {
    const markup = renderToStaticMarkup(React.createElement(AppLogo));
    const text = markup.replace(/<[^>]+>/g, '');

    expect(text).toContain('windows native codexmux');
    expect(text).not.toContain('windows native codexwinmux');
    expect(markup).toContain('title="windows native codexmux"');
    expect(markup).not.toContain('title="codexwinmux"');
  });
});
