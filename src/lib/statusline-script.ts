import path from 'path';
import os from 'os';

const BASE_DIR = path.join(os.homedir(), '.codexwinmux');
export const STATUSLINE_SCRIPT_PATH = path.join(BASE_DIR, 'statusline.sh');
export const RATE_LIMITS_FILE = path.join(BASE_DIR, 'rate-limits.json');

export const STATUSLINE_SCRIPT_CONTENT = `#!/bin/sh
PORT_FILE="$HOME/.codexwinmux/port"
TOKEN_FILE="$HOME/.codexwinmux/cli-token"
[ -f "$PORT_FILE" ] || exit 0
[ -f "$TOKEN_FILE" ] || exit 0
PORT=$(cat "$PORT_FILE")
TOKEN=$(cat "$TOKEN_FILE")
curl -sf --max-time 2 -X POST \\
  -H 'Content-Type: application/json' \\
  -H "x-cmux-token: \${TOKEN}" \\
  --data-binary @- \\
  "http://localhost:\${PORT}/api/status/statusline" 2>/dev/null || exit 0
`;
