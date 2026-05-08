import { useEffect, useMemo } from 'react';
import Head from 'next/head';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import useBrowserTitle from '@/hooks/use-browser-title';
import { APP_DISPLAY_NAME } from '@/lib/app-brand';
import { getPageShellWithTitlebarLayout } from '@/components/layout/page-shell';
import useWebviewStore from '@/hooks/use-webview-store';

const WebviewPage = () => {
  const router = useRouter();
  const url = typeof router.query.url === 'string' ? router.query.url : '';

  const hostname = useMemo(() => {
    if (!url) return 'Webview';
    try { return new URL(url).hostname; }
    catch { return 'Webview'; }
  }, [url]);

  useBrowserTitle(`${hostname} - ${APP_DISPLAY_NAME}`);

  useEffect(() => {
    if (url) {
      useWebviewStore.getState().open(`deeplink:${url}`, url, hostname);
    }
  }, [url, hostname]);

  return (
    <>
      <Head>
        <title>{hostname} - {APP_DISPLAY_NAME}</title>
      </Head>
      <div className="flex min-h-0 flex-1" />
    </>
  );
};

WebviewPage.getLayout = getPageShellWithTitlebarLayout;

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { requireAuth } = await import('@/lib/require-auth');
  const { loadMessagesServerBundle } = await import('@/lib/load-messages');
  return requireAuth(context, async () => {
    const { locale, messages } = await loadMessagesServerBundle();
    return { props: { messages, messagesLocale: locale } };
  });
};

export default WebviewPage;
