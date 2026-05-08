import type { NextApiRequest, NextApiResponse } from 'next';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);
const CMD_TIMEOUT = 5000;

interface ITailscaleServeEntry {
  httpsPort: string;
  proxy: string;
}

interface ITailscaleStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  hostname: string | null;
  dnsName: string | null;
  tailscaleIp: string | null;
  serveEntries: ITailscaleServeEntry[];
  serverPort: number;
}

const DEFAULT_PORT = 8121;

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const result: ITailscaleStatus = {
    installed: false,
    running: false,
    version: null,
    hostname: null,
    dnsName: null,
    tailscaleIp: null,
    serveEntries: [],
    serverPort: parseInt(process.env.PORT || String(DEFAULT_PORT), 10),
  };

  try {
    const { stdout } = await execFile('tailscale', ['version'], { timeout: CMD_TIMEOUT });
    const versionMatch = stdout.trim().match(/^(\d+\.\d+[\d.]*)/);
    result.installed = true;
    result.version = versionMatch?.[1] ?? null;
  } catch {
    return res.status(200).json(result);
  }

  try {
    const { stdout } = await execFile('tailscale', ['status', '--json'], { timeout: CMD_TIMEOUT });
    const data = JSON.parse(stdout);
    result.running = data.BackendState === 'Running';
    result.hostname = data.Self?.HostName ?? null;
    result.dnsName = (data.Self?.DNSName ?? '').replace(/\.$/, '') || null;
    result.tailscaleIp = data.Self?.TailscaleIPs?.[0] ?? null;
  } catch {
    return res.status(200).json(result);
  }

  try {
    const { stdout } = await execFile('tailscale', ['serve', 'status', '--json'], { timeout: CMD_TIMEOUT });
    const data = JSON.parse(stdout);
    const web = data.Web as Record<string, { Handlers: Record<string, { Proxy?: string }> }> | undefined;
    if (web) {
      for (const [hostPort, config] of Object.entries(web)) {
        const portMatch = hostPort.match(/:(\d+)$/);
        const httpsPort = portMatch?.[1] ?? '443';
        const proxy = config.Handlers?.['/' ]?.Proxy ?? '';
        if (proxy) {
          result.serveEntries.push({ httpsPort, proxy });
        }
      }
    }
  } catch {}

  return res.status(200).json(result);
};

export default handler;
