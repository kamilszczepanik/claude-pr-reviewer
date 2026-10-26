import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rightLinesByPath, truncateDiff } from "../scripts/lib/diff.mjs";

const fileDiff = ({ path, hunk }) =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    hunk,
    "",
  ].join("\n");

const SAMPLE_DIFF = [
  fileDiff({
    path: "src/app.ts",
    hunk: [
      "@@ -10,4 +10,5 @@ export const run = () => {",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
      "+const c = 4;",
      " return a;",
      "\\ No newline at end of file",
    ].join("\n"),
  }),
  [
    "diff --git a/old.ts b/old.ts",
    "deleted file mode 100644",
    "--- a/old.ts",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-gone",
    "-gone too",
    "",
  ].join("\n"),
  fileDiff({
    path: "docs/readme.md",
    hunk: ["@@ -1 +1 @@", "-old", "+new"].join("\n"),
  }),
].join("");

describe("rightLinesByPath", () => {
  it("maps context and added lines of the new version, skipping removed and deleted files", () => {
    const lines = rightLinesByPath(SAMPLE_DIFF);
    assert.deepEqual([...lines.get("src/app.ts")], [10, 11, 12, 13]);
    assert.deepEqual([...lines.get("docs/readme.md")], [1]);
    assert.equal(lines.has("old.ts"), false);
  });
});

describe("truncateDiff", () => {
  const cases = [
    {
      maxBytes: 1_000_000,
      keptPaths: ["src/app.ts", "old.ts", "docs/readme.md"],
      omittedFiles: [],
    },
    {
      maxBytes: 150,
      keptPaths: ["old.ts"],
      omittedFiles: ["src/app.ts", "docs/readme.md"],
    },
    {
      maxBytes: 10,
      keptPaths: [],
      omittedFiles: ["src/app.ts", "old.ts", "docs/readme.md"],
    },
  ];
  for (const { maxBytes, keptPaths, omittedFiles } of cases) {
    it(`cuts at file boundaries under ${maxBytes} bytes`, () => {
      const result = truncateDiff({ diff: SAMPLE_DIFF, maxBytes });
      assert.deepEqual(result.omittedFiles, omittedFiles);
      assert.ok(Buffer.byteLength(result.diff) <= maxBytes);
      assert.deepEqual(
        [...result.diff.matchAll(/^diff --git a\/(\S+)/gm)].map(
          (match) => match[1],
        ),
        keptPaths,
      );
    });
  }
});
