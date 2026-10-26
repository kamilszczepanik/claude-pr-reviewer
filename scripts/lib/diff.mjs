const FILE_HEADER = /^diff --git a\/.+ b\/(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export const splitDiffByFile = (diff) => {
  const files = [];
  for (const block of diff.split(/^(?=diff --git )/m)) {
    const header = block.match(/^diff --git a\/.+ b\/(.+)$/m);
    if (header) files.push({ path: header[1], text: block });
  }
  return files;
};

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

export const rightLinesByPath = (diff) => {
  const linesByPath = new Map();
  let lines = null;
  let nextLine = 0;
  for (const row of diff.split("\n")) {
    if (FILE_HEADER.test(row)) {
      lines = null;
      continue;
    }
    if (row.startsWith("+++ ")) {
      const path = row.startsWith("+++ b/") ? row.slice("+++ b/".length) : null;
      lines = path ? new Set() : null;
      if (path) linesByPath.set(path, lines);
      continue;
    }
    const hunk = row.match(HUNK_HEADER);
    if (hunk) {
      nextLine = Number(hunk[1]);
      continue;
    }
    if (!lines || nextLine === 0) continue;
    if (row.startsWith("+") || row.startsWith(" ")) {
      lines.add(nextLine);
      nextLine += 1;
    }
  }
  return linesByPath;
};
