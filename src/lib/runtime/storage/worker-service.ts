import {
  createRuntimeReply,
  parseRuntimeCommandPayload,
  type IRuntimeCommand,
  type IRuntimeReply,
} from '@/lib/runtime/ipc';
import { createStorageRepository } from '@/lib/runtime/storage/repository';
import { openRuntimeDatabase } from '@/lib/runtime/storage/schema';
import { validateWorkerCommandEnvelope, type IInvalidWorkerCommand } from '@/lib/runtime/worker-command-validation';

export interface IStorageWorkerServiceOptions {
  dbPath: string;
}

export const createStorageWorkerService = (options: IStorageWorkerServiceOptions) => {
  const db = openRuntimeDatabase(options.dbPath);
  const repo = createStorageRepository(db);

  const ok = <TPayload>(command: IRuntimeCommand, payload: TPayload): IRuntimeReply<TPayload> =>
    createRuntimeReply({
      commandId: command.id,
      source: 'storage',
      target: command.source,
      type: `${command.type}.reply`,
      ok: true,
      payload,
    });

  const fail = (command: IRuntimeCommand, code: string, message: string, retryable = false): IRuntimeReply<null> =>
    createRuntimeReply({
      commandId: command.id,
      source: 'storage',
      target: command.source,
      type: `${command.type}.reply`,
      ok: false,
      payload: null,
      error: { code, message, retryable },
    });

  const invalidCommand = (command: IRuntimeCommand, error: IInvalidWorkerCommand): IRuntimeReply<null> =>
    createRuntimeReply({
      commandId: command.id,
      source: 'storage',
      target: 'supervisor',
      type: `${command.type}.reply`,
      ok: false,
      payload: null,
      error,
    });

  return {
    async handleCommand(command: IRuntimeCommand): Promise<IRuntimeReply> {
      const invalid = validateWorkerCommandEnvelope(command, { workerName: 'storage', namespace: 'storage' });
      if (invalid) return invalidCommand(command, invalid);
      try {
        if (command.type === 'storage.health') {
          return ok(command, { ok: true });
        }
        if (command.type === 'storage.create-workspace') {
          const input = parseRuntimeCommandPayload('storage.create-workspace', command.payload);
          return ok(command, repo.createWorkspace(input));
        }
        if (command.type === 'storage.rename-workspace') {
          const input = parseRuntimeCommandPayload('storage.rename-workspace', command.payload);
          return ok(command, repo.renameWorkspace(input));
        }
        if (command.type === 'storage.create-workspace-group') {
          const input = parseRuntimeCommandPayload('storage.create-workspace-group', command.payload);
          return ok(command, repo.createWorkspaceGroup(input));
        }
        if (command.type === 'storage.rename-workspace-group') {
          const input = parseRuntimeCommandPayload('storage.rename-workspace-group', command.payload);
          return ok(command, repo.renameWorkspaceGroup(input));
        }
        if (command.type === 'storage.set-workspace-group-collapsed') {
          const input = parseRuntimeCommandPayload('storage.set-workspace-group-collapsed', command.payload);
          return ok(command, { ok: repo.setWorkspaceGroupCollapsed(input) });
        }
        if (command.type === 'storage.delete-workspace-group') {
          const input = parseRuntimeCommandPayload('storage.delete-workspace-group', command.payload);
          return ok(command, { deleted: repo.deleteWorkspaceGroup(input) });
        }
        if (command.type === 'storage.reorder-workspace-groups') {
          const input = parseRuntimeCommandPayload('storage.reorder-workspace-groups', command.payload);
          return ok(command, { ok: repo.reorderWorkspaceGroups(input) });
        }
        if (command.type === 'storage.set-workspace-group') {
          const input = parseRuntimeCommandPayload('storage.set-workspace-group', command.payload);
          return ok(command, { ok: repo.setWorkspaceGroup(input) });
        }
        if (command.type === 'storage.reorder-workspaces') {
          const input = parseRuntimeCommandPayload('storage.reorder-workspaces', command.payload);
          return ok(command, { ok: repo.reorderWorkspaces(input) });
        }
        if (command.type === 'storage.split-pane') {
          const input = parseRuntimeCommandPayload('storage.split-pane', command.payload);
          return ok(command, repo.splitPane(input));
        }
        if (command.type === 'storage.close-pane') {
          const input = parseRuntimeCommandPayload('storage.close-pane', command.payload);
          return ok(command, repo.closePane(input));
        }
        if (command.type === 'storage.patch-layout') {
          const input = parseRuntimeCommandPayload('storage.patch-layout', command.payload);
          return ok(command, repo.patchLayout(input));
        }
        if (command.type === 'storage.patch-pane') {
          const input = parseRuntimeCommandPayload('storage.patch-pane', command.payload);
          return ok(command, repo.patchPane(input));
        }
        if (command.type === 'storage.reorder-tabs') {
          const input = parseRuntimeCommandPayload('storage.reorder-tabs', command.payload);
          return ok(command, repo.reorderTabs(input));
        }
        if (command.type === 'storage.move-tab') {
          const input = parseRuntimeCommandPayload('storage.move-tab', command.payload);
          return ok(command, repo.moveTab(input));
        }
        if (command.type === 'storage.patch-tab') {
          const input = parseRuntimeCommandPayload('storage.patch-tab', command.payload);
          return ok(command, repo.patchTab(input));
        }
        if (command.type === 'storage.patch-tab-status-metadata') {
          const input = parseRuntimeCommandPayload('storage.patch-tab-status-metadata', command.payload);
          return ok(command, repo.patchTabStatusMetadata(input));
        }
        if (command.type === 'storage.get-tab-status-metadata') {
          const input = parseRuntimeCommandPayload('storage.get-tab-status-metadata', command.payload);
          return ok(command, repo.getTabStatusMetadataBySession(input.sessionName));
        }
        if (command.type === 'storage.ensure-workspace-pane') {
          const input = parseRuntimeCommandPayload('storage.ensure-workspace-pane', command.payload);
          return ok(command, repo.ensureWorkspacePane(input));
        }
        if (command.type === 'storage.create-pending-terminal-tab') {
          const input = parseRuntimeCommandPayload('storage.create-pending-terminal-tab', command.payload);
          return ok(command, repo.createPendingTerminalTab(input));
        }
        if (command.type === 'storage.finalize-terminal-tab') {
          const input = parseRuntimeCommandPayload('storage.finalize-terminal-tab', command.payload);
          return ok(command, repo.finalizeTerminalTab(input));
        }
        if (command.type === 'storage.fail-pending-terminal-tab') {
          const input = parseRuntimeCommandPayload('storage.fail-pending-terminal-tab', command.payload);
          repo.failPendingTerminalTab(input);
          return ok(command, { ok: true });
        }
        if (command.type === 'storage.list-pending-terminal-tabs') {
          return ok(command, repo.listPendingTerminalTabs());
        }
        if (command.type === 'storage.list-ready-terminal-tabs') {
          return ok(command, repo.listReadyTerminalTabs());
        }
        if (command.type === 'storage.fail-ready-terminal-tab') {
          const input = parseRuntimeCommandPayload('storage.fail-ready-terminal-tab', command.payload);
          repo.failReadyTerminalTab(input);
          return ok(command, { ok: true });
        }
        if (command.type === 'storage.get-ready-terminal-tab-by-session') {
          const input = parseRuntimeCommandPayload('storage.get-ready-terminal-tab-by-session', command.payload);
          return ok(command, repo.getReadyTerminalTabBySession(input.sessionName));
        }
        if (command.type === 'storage.delete-workspace') {
          const input = parseRuntimeCommandPayload('storage.delete-workspace', command.payload);
          return ok(command, repo.deleteWorkspace(input));
        }
        if (command.type === 'storage.delete-terminal-tab') {
          const input = parseRuntimeCommandPayload('storage.delete-terminal-tab', command.payload);
          return ok(command, repo.deleteTerminalTab(input));
        }
        if (command.type === 'storage.list-workspaces') {
          return ok(command, repo.listWorkspaces());
        }
        if (command.type === 'storage.get-layout') {
          const input = parseRuntimeCommandPayload('storage.get-layout', command.payload);
          return ok(command, repo.getWorkspaceLayout(input.workspaceId));
        }
        return invalidCommand(command, {
          code: 'invalid-worker-command',
          message: `Unsupported storage command: ${command.type}`,
          retryable: false,
        });
      } catch (err) {
        const maybeStructured = err as { code?: string; retryable?: boolean } | null;
        return fail(
          command,
          maybeStructured?.code ?? 'command-failed',
          err instanceof Error ? err.message : String(err),
          maybeStructured?.retryable ?? false,
        );
      }
    },

    close(): void {
      db.close();
    },
  };
};
