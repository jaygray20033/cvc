// Conventional Commits. Task ID scope (e.g. P1.2) is recommended per CLAUDE.md
// but only a *warning* since 2026-11-13 (owner request): any scope word or even
// no scope is accepted, so `feat(auth): ...` and `feat: ...` both pass.
const taskId = (parsed) => {
  const scope = parsed.scope ?? '';
  const ok = /^[A-Z]\d+(\.\d+)?$/.test(scope);
  return [ok, 'scope should be a task ID like P1.2 (see CLAUDE.md)'];
};

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [{ rules: { 'task-id': taskId } }],
  rules: {
    'task-id': [1, 'always'],
    'scope-empty': [0],
    'scope-case': [0],
  },
};
