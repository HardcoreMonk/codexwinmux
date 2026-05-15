import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Android release identity', () => {
  it('generates the release signing certificate with codexwinmux identity', () => {
    const script = readFileSync(path.join(process.cwd(), 'scripts/android-keystore.mjs'), 'utf8');

    expect(script).toContain("'CN=codexwinmux, OU=codexwinmux, O=HardcoreMonk, L=Seoul, ST=Seoul, C=KR'");
    expect(script).not.toContain('CN=codexmux, OU=codexmux');
  });
});
