export type TTailscaleGuideStep = {
  commentKey: 'commentWindows' | 'commentAfterInstall' | 'commentStep1Install' | 'commentStep2Activate' | 'commentStep3Add';
  command: string;
};

export const WINDOWS_TAILSCALE_INSTALL_GUIDE: TTailscaleGuideStep[] = [
  {
    commentKey: 'commentWindows',
    command: 'winget install --id Tailscale.Tailscale -e',
  },
  {
    commentKey: 'commentAfterInstall',
    command: 'tailscale up',
  },
];

export const buildWindowsTailscaleServeGuide = (port: number): TTailscaleGuideStep[] => [
  {
    commentKey: 'commentStep1Install',
    command: 'winget install --id Tailscale.Tailscale -e',
  },
  {
    commentKey: 'commentStep2Activate',
    command: 'tailscale up',
  },
  {
    commentKey: 'commentStep3Add',
    command: `tailscale serve --bg --https=443 http://localhost:${port}`,
  },
];
