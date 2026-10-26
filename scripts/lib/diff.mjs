const GIT_HEADER = "diff --git ";
const FILE_BOUNDARY = /^(?=diff --git )/m;
const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const UNQUOTED_HEADER_PATH = /^diff --git a\/.+ b\/(.+)$/m;
const C_ESCAPES = {
  n: 10,
  t: 9,
  r: 13,
  a: 7,
  b: 8,
  f: 12,
  v: 11,
  '"': 34,
  "\\": 92,
};

const unquotePath = (raw) => {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const bytes = [];
  const inner = raw.slice(1, -1);
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char !== "\\") {
      bytes.push(...Buffer.from(char));
      continue;
    }
    const octal = inner.slice(index + 1, index + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(Number.parseInt(octal, 8));
      index += 3;
      continue;
    }
    const next = inner[index + 1] ?? "\\";
    bytes.push(C_ESCAPES[next] ?? next.charCodeAt(0));
    index += 1;
  }
  return Buffer.from(bytes).toString("utf8");
};

const pathAfter = ({ row, prefix }) => {
  const path = unquotePath(row.slice(4));
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
};

const headerPaths = (block) => {
  const paths = { oldPath: null, newPath: null };
  for (const row of block.split("\n")) {
    if (row.startsWith("@@")) break;
    if (row.startsWith("--- "))
      paths.oldPath = pathAfter({ row, prefix: "a/" });
    if (row.startsWith("+++ "))
      paths.newPath = pathAfter({ row, prefix: "b/" });
  }
  return paths;
};

const fileBlocks = (diff) =>
  diff.split(FILE_BOUNDARY).filter((block) => block.startsWith(GIT_HEADER));

export const splitDiffByFile = (diff) =>
  fileBlocks(diff)
    .map((block) => {
      const { oldPath, newPath } = headerPaths(block);
      return {
        path:
          newPath ?? oldPath ?? block.match(UNQUOTED_HEADER_PATH)?.[1] ?? null,
        text: block,
      };
    })
    .filter((file) => file.path);

export const truncateDiff = ({ diff, maxBytes }) => {
  const kept = [];
  const omittedFiles = [];
  let usedBytes = 0;
  for (const file of splitDiffByFile(diff)) {
    const bytes = Buffer.byteLength(file.text);
    if (usedBytes + bytes > maxBytes) {
      omittedFiles.push(file.path);
      continue;
    }
    kept.push(file.text);
    usedBytes += bytes;
  }
  return { diff: kept.join(""), omittedFiles };
};

const rightLinesOfBlock = (block) => {
  const lines = new Set();
  let oldLeft = 0;
  let newLeft = 0;
  let nextLine = 0;
  for (const row of block.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (row.startsWith("-")) {
        oldLeft -= 1;
        continue;
      }
      if (row.startsWith("+") || row.startsWith(" ")) {
        lines.add(nextLine);
        nextLine += 1;
        newLeft -= 1;
        if (row.startsWith(" ")) oldLeft -= 1;
        continue;
      }
      if (row.startsWith("\\")) continue;
      oldLeft = 0;
      newLeft = 0;
    }
    const hunk = row.match(HUNK_HEADER);
    if (hunk) {
      oldLeft = Number(hunk[1] ?? 1);
      nextLine = Number(hunk[2]);
      newLeft = Number(hunk[3] ?? 1);
    }
  }
  return lines;
};

export const rightLinesByPath = (diff) => {
  const linesByPath = new Map();
  for (const block of fileBlocks(diff)) {
    const { newPath } = headerPaths(block);
    if (newPath) linesByPath.set(newPath, rightLinesOfBlock(block));
  }
  return linesByPath;
};
