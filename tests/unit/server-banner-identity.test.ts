import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('server banner identity', () => {
  it('prints codexwinmux in the dev server banner', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');

    expect(source).toContain('⚡ codexwinmux');
    expect(source).not.toContain('⚡ codexmux');
  });
});
