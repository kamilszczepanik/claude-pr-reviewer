import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const GUARDED_TOOLS = 'Read|Grep|Glob';

const GLOB_CHARS = /[*?[{]/;
const DENIAL = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'Odczyt poza sprawdzonym repozytorium jest zablokowany',
  },
};

const realOrResolved = async (path) => {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
};

const isInside = ({ root, target }) => {
  const path = relative(root, target);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
};

const staticPrefix = (pattern) => {
  const firstGlob = pattern.search(GLOB_CHARS);
  return firstGlob === -1 ? pattern : dirname(pattern.slice(0, firstGlob + 1));
};

const requestedPaths = ({ toolName, toolInput }) => {
  const base = toolInput.path ?? '.';
  if (toolName === 'Read') return [toolInput.file_path ?? ''];
  if (toolName !== 'Glob') return [base];
  const pattern = toolInput.pattern ?? '';
  const full = isAbsolute(pattern) ? pattern : join(base, pattern);
  return [base, full, staticPrefix(full)];
};

export const createRepoGuard = ({ root, onDeny }) => {
  const realRoot = realOrResolved(root);
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const rootPath = await realRoot;
    const paths = requestedPaths({ toolName: input.tool_name, toolInput: input.tool_input ?? {} });
    const targets = await Promise.all(paths.map((path) => realOrResolved(resolve(rootPath, path))));
    if (targets.every((target) => isInside({ root: rootPath, target }))) return {};
    onDeny();
    return DENIAL;
  };
};
