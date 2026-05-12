import os from 'os';
import path from 'path';
import { createRuntimeReply, parseRuntimeMessage } from '@/lib/runtime/ipc';
import { createStorageWorkerService } from '@/lib/runtime/storage/worker-service';

const dbPath = process.env.CODEXMUX_RUNTIME_DB
  || path.join(process.env.HOME || os.homedir(), '.codexwinmux', 'runtime-v2', 'state.db');

const service = createStorageWorkerService({ dbPath });

process.on('message', async (raw) => {
  try {
    const msg = parseRuntimeMessage(raw);
    if (msg.kind !== 'command') return;
    const reply = await service.handleCommand(msg);
    process.send?.(reply);
  } catch (err) {
    const commandId = typeof raw === 'object' && raw && 'id' in raw && typeof raw.id === 'string'
      ? raw.id
      : null;
    if (!commandId) return;
    process.send?.(createRuntimeReply({
      commandId,
      source: 'storage',
      target: 'supervisor',
      type: 'storage.invalid-command.reply',
      ok: false,
      payload: null,
      error: {
        code: 'invalid-worker-command',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      },
    }));
  }
});

process.on('disconnect', () => {
  service.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  service.close();
  process.exit(0);
});
