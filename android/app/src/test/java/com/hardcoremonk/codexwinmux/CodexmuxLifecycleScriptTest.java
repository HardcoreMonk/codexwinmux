package com.hardcoremonk.codexwinmux;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class CodexmuxLifecycleScriptTest {
    @Test
    public void lifecycleGuardInstallsCapacitorTriggerEventFallback() {
        String script = CodexmuxLifecycleScript.lifecycleGuard();

        assertTrue(script.contains("window.Capacitor"));
        assertTrue(script.contains("triggerEvent"));
        assertTrue(script.contains("document.dispatchEvent"));
        assertFalse(script.contains("window.Capacitor.triggerEvent("));
    }

    @Test
    public void nativeAppStateDispatchRunsAfterLifecycleGuard() {
        String script = CodexmuxLifecycleScript.nativeAppState(true);

        assertTrue(script.indexOf("triggerEvent") < script.indexOf("codexmux:native-app-state"));
        assertTrue(script.contains("active:true"));
    }
}
