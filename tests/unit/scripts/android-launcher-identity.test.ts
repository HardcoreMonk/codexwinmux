import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readLauncherHtml = () =>
  readFileSync(path.join(process.cwd(), 'android-web/index.html'), 'utf8');

describe('Android launcher identity', () => {
  it('does not auto-connect fresh installs to the legacy codexmux tailnet host', () => {
    const html = readLauncherHtml();

    expect(html).toContain("const DEFAULT_SERVER_URL = '';");
    expect(html).not.toContain("const DEFAULT_SERVER_URL = 'https://gti12.tail73c4be.ts.net';");
    expect(html).not.toContain("showServer(DEFAULT_SERVER_URL, 'default', true);");
  });

  it('uses codexwinmux storage keys while keeping legacy codexmux keys manual-only', () => {
    const html = readLauncherHtml();

    expect(html).toContain("const CURRENT_KEY = 'codexwinmux:server-url';");
    expect(html).toContain("const RECENT_KEY = 'codexwinmux:recent-server-urls';");
    expect(html).toContain("const LEGACY_CURRENT_KEY = 'codexmux:server-url';");
    expect(html).toContain("const LEGACY_RECENT_KEY = 'codexmux:recent-server-urls';");
    expect(html).toContain('const migrated = migrateLegacyServerCandidate();');
    expect(html).toContain('showForm(migrated || DEFAULT_SERVER_URL);');
  });

  it('blocks the previous public codexmux host from legacy migration candidates', () => {
    const html = readLauncherHtml();

    expect(html).toContain("const BLOCKED_LEGACY_HOSTS = new Set(['gti12.tail73c4be.ts.net']);");
    expect(html).toContain('if (!legacy || isBlockedLegacyServer(legacy)) return');
    expect(html).toContain('readRecentFromKey(LEGACY_RECENT_KEY).filter((legacyUrl) => !isBlockedLegacyServer(legacyUrl))');
  });
});
