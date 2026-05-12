package com.hardcoremonk.codexwinmux;

import android.os.Bundle;
import android.os.Looper;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private void evaluateScript(String js) {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;

        if (Looper.myLooper() == Looper.getMainLooper()) {
            webView.evaluateJavascript(js, null);
            return;
        }
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private void ensureCapacitorLifecycleGuard() {
        evaluateScript(CodexmuxLifecycleScript.lifecycleGuard());
    }

    private void dispatchAppState(boolean active) {
        evaluateScript(CodexmuxLifecycleScript.nativeAppState(active));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null) {
            getBridge().setWebViewClient(new CodexmuxWebViewClient(getBridge()));
            getBridge().getWebView().addJavascriptInterface(new CodexmuxAppInfo(this), "CodexmuxAndroid");
        }
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });
    }

    @Override
    public void onResume() {
        ensureCapacitorLifecycleGuard();
        super.onResume();
        dispatchAppState(true);
    }

    @Override
    public void onPause() {
        dispatchAppState(false);
        super.onPause();
    }
}
