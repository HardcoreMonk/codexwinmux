import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import * as pty from 'node-pty';
import os from 'os';
import { needsSetup } from '@/lib/config-store';
import { verifyRequestSession } from '@/lib/auth';
import { buildShellEnv } from '@/lib/shell-env';
import { PRISTINE_ENV } from '@/lib/pristine-env';
import { MSG_STDIN, MSG_RESIZE, encodeStdout, textDecoder } from '@/lib/terminal-protocol';
import { createLogger } from '@/lib/logger';

const log = createLogger('install');

const RUNTIME_INSTALL_COMMANDS = new Set([
  'tmux-install', 'tmux-upgrade', 'git', 'codex', 'codex-path', 'codex-login',
]);

const MAC_INSTALL_COMMANDS: Record<string, string> = Object.freeze({
  clt: 'xcode-select --install 2>&1; sleep 1; open -b com.apple.dt.CommandLineTools.installondemand 2>/dev/null; echo ""; echo "Waiting for installation..."; while ! xcode-select -p &>/dev/null; do sleep 3; done; echo ""; echo "Command Line Tools installed."',
  brew: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
  'tmux-install': 'brew install tmux',
  'tmux-upgrade': 'brew upgrade tmux',
  git: 'brew install git',
  codex: 'npm install -g @openai/codex',
  'codex-path': 'echo "Ensure the npm global bin directory is in PATH, then restart codexwinmux."; echo ""; codex --version',
  'codex-login': 'codex login',
});

const LINUX_INSTALL_COMMANDS: Record<string, string> = Object.freeze({
  'tmux-install': 'echo "Install tmux using your package manager:"; echo "  Ubuntu/Debian: sudo apt install tmux"; echo "  Fedora: sudo dnf install tmux"; echo "  Arch: sudo pacman -S tmux"; echo ""; echo "After installing, refresh this page."',
  'tmux-upgrade': 'echo "Upgrade tmux using your package manager:"; echo "  Ubuntu/Debian: sudo apt install --only-upgrade tmux"; echo "  Fedora: sudo dnf upgrade tmux"; echo "  Arch: sudo pacman -Syu tmux"; echo ""; echo "After upgrading, refresh this page."',
  git: 'echo "Install git using your package manager:"; echo "  Ubuntu/Debian: sudo apt install git"; echo "  Fedora: sudo dnf install git"; echo "  Arch: sudo pacman -S git"; echo ""; echo "After installing, refresh this page."',
  codex: 'npm install -g @openai/codex',
  'codex-path': 'echo "Ensure the npm global bin directory is in PATH, then restart codexwinmux."; echo ""; codex --version',
  'codex-login': 'codex login',
});

const INSTALL_COMMANDS: Record<string, string> =
  process.platform === 'linux' ? LINUX_INSTALL_COMMANDS : MAC_INSTALL_COMMANDS;

let activeConn: { ws: WebSocket; pty: pty.IPty } | null = null;

const cleanup = () => {
  if (!activeConn) return;
  const conn = activeConn;
  activeConn = null;

  try {
    if ('destroy' in conn.pty) {
      (conn.pty as pty.IPty & { destroy: () => void }).destroy();
    } else {
      conn.pty.kill();
    }
  } catch {
    // already exited
  }
};

const disposeAll = (disposables: pty.IDisposable[]) => {
  for (const d of disposables) d.dispose();
  disposables.length = 0;
};

export const handleInstallConnection = async (ws: WebSocket, request: IncomingMessage) => {
  const url = new URL(request.url || '', 'http://localhost');
  const command = url.searchParams.get('command');

  if (!command || !(command in INSTALL_COMMANDS)) {
    ws.close(1008, 'Invalid command');
    return;
  }

  const isOnboarding = await needsSetup();
  if (!isOnboarding) {
    if (!RUNTIME_INSTALL_COMMANDS.has(command)) {
      ws.close(1008, 'Command only available during onboarding');
      return;
    }
    if (!(await verifyRequestSession(request.headers.cookie))) {
      ws.close(1008, 'Unauthorized');
      return;
    }
  }

  if (activeConn) {
    cleanup();
  }

  const shell = os.userInfo().shell || PRISTINE_ENV.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  const cols = parseInt(url.searchParams.get('cols') || '', 10) || 80;
  const rows = parseInt(url.searchParams.get('rows') || '', 10) || 24;

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(shell, ['-il'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: PRISTINE_ENV.HOME || '/',
      env: {
        ...buildShellEnv(),
        SHELL: shell,
      },
    });
  } catch (err) {
    log.error(`pty spawn failed: ${err instanceof Error ? err.message : err}`);
    ws.close(1011, 'PTY spawn failed');
    return;
  }

  activeConn = { ws, pty: ptyProcess };
  log.info(`install session started: ${command} (pid: ${ptyProcess.pid})`);

  const disposables: pty.IDisposable[] = [];

  disposables.push(
    ptyProcess.onData((data: string) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(encodeStdout(data));
    }),
  );

  disposables.push(
    ptyProcess.onExit(() => {
      log.info(`install pty exited: ${command}`);
      disposeAll(disposables);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Process exited');
      }
      if (activeConn?.pty === ptyProcess) {
        activeConn = null;
      }
    }),
  );

  ws.on('message', (raw: Buffer | ArrayBuffer) => {
    const data = new Uint8Array(
      raw instanceof ArrayBuffer ? raw : raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    );
    if (data.length === 0) return;

    const type = data[0];
    const payload = data.slice(1);

    switch (type) {
      case MSG_STDIN:
        ptyProcess.write(textDecoder.decode(payload));
        break;
      case MSG_RESIZE:
        if (payload.length >= 4) {
          const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
          const newCols = view.getUint16(0);
          const newRows = view.getUint16(2);
          if (newCols > 0 && newRows > 0) {
            ptyProcess.resize(newCols, newRows);
          }
        }
        break;
    }
  });

  ws.on('close', () => {
    disposeAll(disposables);
    if (activeConn?.ws === ws) cleanup();
  });

  ws.on('error', () => {
    disposeAll(disposables);
    if (activeConn?.ws === ws) cleanup();
  });

  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ptyProcess.write(INSTALL_COMMANDS[command] + '\n');
    }
  }, 300);
};

export const gracefulInstallShutdown = () => {
  if (activeConn && activeConn.ws.readyState === WebSocket.OPEN) {
    activeConn.ws.close(1001, 'Server shutting down');
  }
  cleanup();
};
