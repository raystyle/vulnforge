// P3 acceptance: drive the REAL corpus through our own sync pipeline.
// Workspace root comes from the environment (VULNFORGE_WORKSPACE) or the
// caller's cwd walk-up — no machine-specific paths in the harness.
import { openTemplatesRepo } from "../src/nuclei/config.ts";
import { TemplateDb } from "../src/nuclei/meta.ts";
import { runBatchSync, syncFilterFromConfig } from "../src/nuclei/sync-machine.ts";

const start = process.argv[2] ?? process.env.VULNFORGE_WORKSPACE ?? process.cwd();
const repo = openTemplatesRepo(start);
console.log("repo:", repo.root);
console.log("db:", repo.dbPath);
const db = new TemplateDb(repo.dbPath);
const started = Date.now();
const result = await runBatchSync(db, repo.root, {
  filter: syncFilterFromConfig(repo.config),
});
const elapsed = (Date.now() - started) / 1000;
console.log(
  JSON.stringify(
    {
      processed: result.processed,
      inserted: result.inserted,
      updated: result.updated,
      errors: result.errors,
      elapsedSecs: Math.round(elapsed),
      lintFindings: result.lintFindings.length,
    },
    null,
    2,
  ),
);
db.close();
