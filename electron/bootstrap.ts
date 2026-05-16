import fs from 'fs';
import os from 'os';
import path from 'path';

const trace = (stage: string): void => {
  if (process.env.CODEXWINMUX_CORE_BOOTSTRAP_TRACE !== '1') return;
  try {
    const target = process.env.CODEXWINMUX_CORE_BOOTSTRAP_TRACE_FILE
      || path.join(os.tmpdir(), 'codexwinmux-core-bootstrap-trace.log');
    fs.appendFileSync(target, `${new Date().toISOString()} ${stage}\n`);
  } catch {
    // Diagnostic-only path.
  }
};

trace('bootstrap:before-main');
const runtimeRequire = module.require.bind(module);
if (process.env.CODEXWINMUX_CORE_BOOTSTRAP_TRACE === '1') {
  const Module = runtimeRequire('module') as typeof import('module') & {
    _load?: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
  };
  const originalLoad = Module._load;
  if (originalLoad) {
    Module._load = function tracedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
      trace(`bootstrap:load:${request}`);
      return originalLoad.apply(this, [request, parent, isMain]);
    };
  }
}
runtimeRequire(path.join(__dirname, 'main.js'));
trace('bootstrap:after-main');
