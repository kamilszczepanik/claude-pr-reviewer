import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { createRepoGuard } from '../scripts/lib/tool-guard.mjs';

const OUTSIDE = '/etc/hosts';

describe('createRepoGuard', () => {
  let root;
  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'reviewer-guard-'));
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'a.mjs'), 'x');
    await symlink(OUTSIDE, join(root, 'escape'));
    await symlink('/etc', join(root, 'escape-dir'));
  });

  const cases = [
    { tool: 'Read', input: () => ({ file_path: join(root, 'src', 'a.mjs') }), denied: false },
    { tool: 'Read', input: () => ({ file_path: 'src/a.mjs' }), denied: false },
    { tool: 'Read', input: () => ({ file_path: OUTSIDE }), denied: true },
    { tool: 'Read', input: () => ({ file_path: join(root, 'escape') }), denied: true },
    { tool: 'Read', input: () => ({ file_path: '/proc/self/environ' }), denied: true },
    { tool: 'Grep', input: () => ({ pattern: 'x' }), denied: false },
    { tool: 'Grep', input: () => ({ pattern: 'x', path: '..' }), denied: true },
    { tool: 'Glob', input: () => ({ pattern: '**/*.mjs' }), denied: false },
    { tool: 'Glob', input: () => ({ pattern: '../*' }), denied: true },
    { tool: 'Glob', input: () => ({ pattern: '/etc/*' }), denied: true },
    { tool: 'Glob', input: () => ({ pattern: 'escape-dir/*' }), denied: true },
  ];
  for (const [index, { tool, input, denied }] of cases.entries()) {
    it(`${denied ? 'denies' : 'allows'} ${tool} case ${index}`, async () => {
      let denials = 0;
      const guard = createRepoGuard({ root, onDeny: () => (denials += 1) });
      const output = await guard({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input() });
      assert.equal(output.hookSpecificOutput?.permissionDecision === 'deny', denied);
      assert.equal(denials, denied ? 1 : 0);
    });
  }
});
