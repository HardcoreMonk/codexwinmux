import { describe, expect, it } from 'vitest';
import { WINDOWS_TAILSCALE_INSTALL_GUIDE, buildWindowsTailscaleServeGuide } from '@/lib/tailscale-install-guide';

describe('Windows Tailscale install guide', () => {
  it('uses Windows install steps without macOS or Linux commands', () => {
    const text = WINDOWS_TAILSCALE_INSTALL_GUIDE.map((step) => `${step.commentKey} ${step.command ?? ''}`).join('\n');

    expect(text).toContain('commentWindows');
    expect(text).toContain('winget install --id Tailscale.Tailscale -e');
    expect(text).toContain('tailscale up');
    expect(text).not.toContain('brew install tailscale');
    expect(text).not.toContain('tailscale.com/install.sh');
    expect(text).not.toContain('commentMac');
    expect(text).not.toContain('commentLinux');
  });

  it('builds Windows serve steps for the active server port', () => {
    expect(buildWindowsTailscaleServeGuide(8121).map((step) => step.command)).toEqual([
      'winget install --id Tailscale.Tailscale -e',
      'tailscale up',
      'tailscale serve --bg --https=443 http://localhost:8121',
    ]);
  });
});
