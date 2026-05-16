import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['electron/bootstrap.ts', 'electron/main.ts', 'electron/preload.ts'],
  format: ['cjs'],
  target: 'node20',
  outDir: 'dist-electron',
  clean: true,
  external: ['electron'],
  noExternal: ['electron-updater', 'builder-util-runtime', 'nanoid', 'zod'],
  esbuildOptions(options) {
    options.alias = {
      '@': './src',
    };
  },
});
