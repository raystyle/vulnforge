import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { syncFromFiles, TemplateDb } from "../../src/nuclei/meta.ts";

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const TPL = (id: string, tag: string) => `id: ${id}
info:
  name: ${id} detection
  author: test
  severity: info
  tags: shared-tag,${tag}
http:
  - method: GET
    path:
      - "{{BaseURL}}/x"
    matchers:
      - type: word
        words:
          - "marker"
`;

describe("search totalCount (the truncation regression)", () => {
  it("reports the true count beyond the LIMIT and a consistent count under it", async () => {
    const root = mkdtempSync(join(tmpdir(), "vf-count-"));
    scratch.push(root);
    mkdirSync(join(root, "http"), { recursive: true });
    // 60 templates share the searchable token; LIMIT default is 50.
    for (let i = 0; i < 60; i += 1) {
      writeFileSync(join(root, "http", `tpl-${String(i).padStart(3, "0")}.yaml`), TPL(`tpl-${i}`, "shared"));
    }
    const db = new TemplateDb(join(root, "t.db"));
    try {
      await syncFromFiles(db, root);
      const rows = db.search("shared") as Array<{ id: string }> & { totalCount?: number };
      expect(rows).toHaveLength(50);
      expect(rows.totalCount).toBe(60);

      // A distinctive single-word token (unique tag) stays under the LIMIT.
      writeFileSync(join(root, "http", "only.yaml"), TPL("only-one", "uniquetag"));
      await syncFromFiles(db, root);
      const under = db.search("uniquetag") as Array<{ id: string }> & { totalCount?: number };
      expect(under).toHaveLength(1);
      expect(under.totalCount).toBe(1);
    } finally {
      db.close();
    }
  });
});
