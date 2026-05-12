package com.hardcoremonk.codexwinmux;

import android.net.Uri;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

public class CodexmuxWebViewClient extends BridgeWebViewClient {
    private final Bridge bridge;

    public CodexmuxWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (shouldShowLauncher(request)) {
            loadLauncher(view, "network");
            return;
        }
        super.onReceivedError(view, request, error);
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
        if (shouldShowLauncher(request) && errorResponse != null && errorResponse.getStatusCode() >= 400) {
            loadLauncher(view, "http");
            return;
        }
        super.onReceivedHttpError(view, request, errorResponse);
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        if (shouldShowLauncher(error != null ? error.getUrl() : null, true)) {
            handler.cancel();
            loadLauncher(view, "ssl");
            return;
        }
        super.onReceivedSslError(view, handler, error);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        if (view != null) {
            view.evaluateJavascript(CodexmuxLifecycleScript.lifecycleGuard(), null);
        }
    }

    private boolean shouldShowLauncher(WebResourceRequest request) {
        if (request == null || !request.isForMainFrame() || request.getUrl() == null) return false;
        return shouldShowLauncher(request.getUrl().toString(), true);
    }

    private boolean shouldShowLauncher(String url, boolean mainFrame) {
        if (!mainFrame || url == null) return false;
        String localUrl = bridge.getLocalUrl();
        return localUrl != null && !url.startsWith(localUrl);
    }

    private void loadLauncher(WebView view, String reason) {
        if (view == null) return;
        String localUrl = bridge.getLocalUrl();
        if (localUrl == null) return;
        String separator = localUrl.endsWith("/") ? "" : "/";
        String launcherUrl = localUrl + separator + "?connection=failed&reason=" + Uri.encode(reason);
        view.stopLoading();
        view.post(() -> view.loadUrl(launcherUrl));
    }
}
