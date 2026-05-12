import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Copy, ExternalLink, Info, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import Spinner from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import isElectron from '@/hooks/use-is-electron';
import { WINDOWS_TAILSCALE_INSTALL_GUIDE, buildWindowsTailscaleServeGuide } from '@/lib/tailscale-install-guide';

interface IServeEntry {
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
  serveEntries: IServeEntry[];
  serverPort: number;
}

const DEFAULT_PORT = 8121;

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleCopy}>
      {copied ? <Check className="h-3 w-3 text-positive" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
};

const NotInstalledGuide = () => {
  const t = useTranslations('settings.tailscale');

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border border-ui-amber/30 bg-ui-amber/5 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-ui-amber" />
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('notInstalled')}</p>
          <p className="text-sm text-muted-foreground">
            {t('notInstalledDescription')}
          </p>
        </div>
      </div>
      <div className="rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
        {WINDOWS_TAILSCALE_INSTALL_GUIDE.map((step, index) => (
          <div key={step.commentKey} className={index === 0 ? undefined : 'mt-2'}>
            <p className="text-muted-foreground/60">{t(step.commentKey)}</p>
            <p>{step.command}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {t.rich('installGuide', {
          link: (chunks) => (
            <a
              href="https://tailscale.com/download"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline hover:text-foreground"
            >
              {chunks}
              <ExternalLink className="h-3 w-3" />
            </a>
          ),
        })}
      </p>
    </div>
  );
};

const TailscaleSettings = () => {
  const t = useTranslations('settings.tailscale');
  const [status, setStatus] = useState<ITailscaleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/tailscale/status');
      if (!res.ok) throw new Error();
      const data: ITailscaleStatus = await res.json();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleRemove = async (httpsPort: string) => {
    setActionLoading(`remove-${httpsPort}`);
    try {
      const res = await fetch('/api/tailscale/serve', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ httpsPort }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('removeFailed'));
      }
      toast.success(t('removedToast', { httpsPort }));
      await fetchStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('removeFailed'));
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }

  if (!status || !status.installed) {
    return <NotInstalledGuide />;
  }

  if (!status.running) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-ui-amber/30 bg-ui-amber/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-ui-amber" />
          <div className="space-y-1">
            <p className="text-sm font-medium">{t('notRunning')}</p>
            <p className="text-sm text-muted-foreground">{t('notRunningDescription')}</p>
          </div>
        </div>
        <div className="rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
          <p>tailscale up</p>
        </div>
      </div>
    );
  }

  const activeEntries = status.serveEntries;
  const currentPort = status.serverPort;
  const isNonDefaultPort = currentPort !== DEFAULT_PORT;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{t('deviceInfo')}</p>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setLoading(true); fetchStatus(); }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="rounded-md border p-3 text-sm">
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5">
            <span className="text-muted-foreground">{t('host')}</span>
            <span className="font-mono text-xs">{status.hostname}</span>
            <span className="text-muted-foreground">DNS</span>
            <div className="flex items-center gap-1">
              <span className="font-mono text-xs">{status.dnsName}</span>
              {status.dnsName && <CopyButton text={status.dnsName} />}
            </div>
            <span className="text-muted-foreground">IP</span>
            <div className="flex items-center gap-1">
              <span className="font-mono text-xs">{status.tailscaleIp}</span>
              {status.tailscaleIp && <CopyButton text={status.tailscaleIp} />}
            </div>
            <span className="text-muted-foreground">{t('version')}</span>
            <span className="font-mono text-xs">{status.version}</span>
          </div>
        </div>
      </div>

      {isNonDefaultPort && (
        <div className="flex items-start gap-3 rounded-md border border-accent-color/30 bg-accent-color/5 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-accent-color" />
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {t('nonDefaultPortTitle', { port: currentPort })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('nonDefaultPortDescription', {
                defaultPort: DEFAULT_PORT,
                currentPort,
                restartAction: isElectron ? t('appRestart') : t('serverRestart'),
              })}
            </p>
            <div className="rounded-md bg-muted p-2.5 font-mono text-xs leading-relaxed">
              <p className="text-muted-foreground/60">{t('commentFixedPort', { port: DEFAULT_PORT })}</p>
              <p>PORT={DEFAULT_PORT} codexwinmux</p>
              <p className="mt-1.5 text-muted-foreground/60">{t('commentOrTerminate', { port: DEFAULT_PORT })}</p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-sm font-medium">{t('serveStatus')}</p>
        {activeEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noActiveServe')}</p>
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">{t('httpsPort')}</th>
                  <th className="px-3 py-2 text-left font-medium">{t('proxyTarget')}</th>
                  <th className="px-3 py-2 text-left font-medium">{t('url')}</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {activeEntries.map((entry) => {
                  const url = entry.httpsPort === '443'
                    ? `https://${status.dnsName}`
                    : `https://${status.dnsName}:${entry.httpsPort}`;
                  return (
                    <tr key={entry.httpsPort} className="border-b last:border-b-0">
                      <td className="px-3 py-2 font-mono text-xs">{entry.httpsPort}</td>
                      <td className="px-3 py-2 font-mono text-xs">{entry.proxy}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs underline hover:text-foreground"
                          >
                            {url}
                          </a>
                          <CopyButton text={url} />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          disabled={actionLoading !== null}
                          onClick={() => handleRemove(entry.httpsPort)}
                        >
                          {actionLoading === `remove-${entry.httpsPort}` ? (
                            <Spinner className="h-3 w-3" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">{t('setupGuide')}</p>
        <div className="rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
          {buildWindowsTailscaleServeGuide(currentPort).map((step, index) => (
            <div key={step.commentKey} className={index === 0 ? undefined : 'mt-2'}>
              <p className="text-muted-foreground/60">{t(step.commentKey)}</p>
              <p>{step.command}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TailscaleSettings;
