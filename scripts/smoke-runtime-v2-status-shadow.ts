#!/usr/bin/env tsx
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  shouldProcessHookEvent,
  shouldSendNeedsInputNotification,
  shouldSendReviewNotification,
} from '@/lib/status-notification-policy';
import { reduceCodexState, reduceHookState } from '@/lib/status-state-machine';
import { compareRuntimeStatusShadowDecision } from '@/lib/runtime/status-shadow-compare';
import { createRuntimeSupervisorForTest } from '@/lib/runtime/supervisor';
import { evaluateStatusClientEvent } from '@/lib/status-client-event-policy';
import { evaluateStatusSideEffects } from '@/lib/status-side-effect-policy';
import { readRuntimeEnvAlias } from './runtime-env-alias';

const main = async (): Promise<void> => {
  const homeDir = readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_V2_STATUS_SHADOW_HOME')
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-v2-status-shadow-'));
  const dbPath = path.join(homeDir, 'runtime-v2', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  const supervisor = createRuntimeSupervisorForTest({ dbPath, runtimeReset: true });
  const checks: string[] = [];

  try {
    await supervisor.ensureStarted();
    checks.push('workers-started');

    const hookInput = {
      currentState: 'busy' as const,
      eventName: 'stop' as const,
      providerId: 'codex',
    };
    const expectedHook = reduceHookState(hookInput);
    const actualHook = await supervisor.reduceStatusHookState(hookInput);
    const hookCompare = compareRuntimeStatusShadowDecision('hook-state', expectedHook, actualHook);
    if (!hookCompare.ok) {
      throw new Error(`runtime v2 status hook mismatch: ${JSON.stringify(hookCompare.mismatches)}`);
    }
    checks.push('hook-state-shadow');

    const codexInput = {
      currentState: 'busy' as const,
      running: true,
      hasJsonlPath: true,
      idle: true,
      hasCompletionSnippet: true,
    };
    const expectedCodex = reduceCodexState(codexInput);
    const actualCodex = await supervisor.reduceStatusCodexState(codexInput);
    const codexCompare = compareRuntimeStatusShadowDecision('codex-state', expectedCodex, actualCodex);
    if (!codexCompare.ok) {
      throw new Error(`runtime v2 status codex mismatch: ${JSON.stringify(codexCompare.mismatches)}`);
    }
    checks.push('codex-state-shadow');

    const policyInput = {
      eventName: 'notification' as const,
      notificationType: 'permission_prompt',
      newState: 'needs-input',
      silent: false,
    };
    const expectedPolicy = {
      processHookEvent: shouldProcessHookEvent(policyInput.eventName, policyInput.notificationType),
      sendReviewNotification: shouldSendReviewNotification(policyInput.newState, policyInput.silent),
      sendNeedsInputNotification: shouldSendNeedsInputNotification(policyInput.newState, policyInput.silent),
    };
    const actualPolicy = await supervisor.evaluateStatusNotificationPolicy(policyInput);
    const policyCompare = compareRuntimeStatusShadowDecision('notification-policy', expectedPolicy, actualPolicy);
    if (!policyCompare.ok) {
      throw new Error(`runtime v2 status policy mismatch: ${JSON.stringify(policyCompare.mismatches)}`);
    }
    checks.push('notification-policy-shadow');

    const sideEffectInput = {
      previousState: 'busy' as const,
      newState: 'ready-for-review' as const,
      hasJsonlPath: true,
      providerId: 'codex',
      hasJsonlWatcher: true,
      sessionHistoryDedupeAccepted: true,
      reviewNotificationDedupeAccepted: true,
    };
    const expectedSideEffects = evaluateStatusSideEffects(sideEffectInput);
    const actualSideEffects = await supervisor.evaluateStatusSideEffects(sideEffectInput);
    const sideEffectCompare = compareRuntimeStatusShadowDecision('side-effect', expectedSideEffects, actualSideEffects);
    if (!sideEffectCompare.ok) {
      throw new Error(`runtime v2 status side-effect mismatch: ${JSON.stringify(sideEffectCompare.mismatches)}`);
    }
    checks.push('side-effect-shadow');

    const ackInput = {
      eventType: 'ack-notification' as const,
      currentState: 'needs-input' as const,
      lastEventName: 'notification' as const,
      lastEventSeq: 9,
      clientSeq: 9,
    };
    const expectedAck = evaluateStatusClientEvent(ackInput);
    const actualAck = await supervisor.evaluateStatusClientEvent(ackInput);
    const ackCompare = compareRuntimeStatusShadowDecision('client-event-ack', expectedAck, actualAck);
    if (!ackCompare.ok) {
      throw new Error(`runtime v2 status ack mismatch: ${JSON.stringify(ackCompare.mismatches)}`);
    }

    const dismissInput = {
      eventType: 'dismiss-tab' as const,
      currentState: 'ready-for-review' as const,
      lastEventName: null,
      lastEventSeq: null,
      clientSeq: null,
    };
    const expectedDismiss = evaluateStatusClientEvent(dismissInput);
    const actualDismiss = await supervisor.evaluateStatusClientEvent(dismissInput);
    const dismissCompare = compareRuntimeStatusShadowDecision('client-event-dismiss', expectedDismiss, actualDismiss);
    if (!dismissCompare.ok) {
      throw new Error(`runtime v2 status dismiss mismatch: ${JSON.stringify(dismissCompare.mismatches)}`);
    }
    checks.push('client-event-shadow');

    console.log(JSON.stringify({
      ok: true,
      homeDir,
      checks,
    }, null, 2));
  } finally {
    supervisor.shutdown();
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
