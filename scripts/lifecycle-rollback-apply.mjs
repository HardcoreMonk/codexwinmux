#!/usr/bin/env node
import { applyLifecycleRollbackMutation } from './lifecycle-rollback-dry-run-lib.mjs';

const main = async () => {
  const result = await applyLifecycleRollbackMutation();
  console.log(JSON.stringify(result, null, 2));
};

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    code: 'lifecycle-rollback-apply-failed',
    message: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
