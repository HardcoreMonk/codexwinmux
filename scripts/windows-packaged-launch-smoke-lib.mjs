export const buildWindowsAppProcessIdScript = () => [
  '$target = $env:CODEXMUX_SMOKE_APP_PATH',
  'Get-CimInstance Win32_Process |',
  '  Where-Object { $_.ExecutablePath -eq $target } |',
  '  Select-Object -ExpandProperty ProcessId',
].join('\n');

export const parseWindowsProcessIds = (output) =>
  String(output || '')
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);

export const parseWindowsPackagedLaunchHoldMs = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};
