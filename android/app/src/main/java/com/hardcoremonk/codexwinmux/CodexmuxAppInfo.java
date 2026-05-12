package com.hardcoremonk.codexwinmux;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;

public class CodexmuxAppInfo {
    private final Context context;

    public CodexmuxAppInfo(Context context) {
        this.context = context;
    }

    @JavascriptInterface
    public String getPackageName() {
        return context.getPackageName();
    }

    @JavascriptInterface
    public String getVersionName() {
        try {
            return getPackageInfo().versionName;
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    @SuppressWarnings("deprecation")
    public String getVersionCode() {
        try {
            PackageInfo info = getPackageInfo();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return String.valueOf(info.getLongVersionCode());
            }
            return String.valueOf(info.versionCode);
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    public String getAndroidVersion() {
        return Build.VERSION.RELEASE;
    }

    @JavascriptInterface
    public String getDeviceModel() {
        return Build.MODEL;
    }

    @JavascriptInterface
    public void restartApp() {
        new Handler(Looper.getMainLooper()).post(() -> {
            Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (intent == null) return;

            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            context.startActivity(intent);

            if (context instanceof Activity) {
                Activity activity = (Activity) context;
                activity.finish();
            }
        });
    }

    private PackageInfo getPackageInfo() throws Exception {
        return context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
    }
}
