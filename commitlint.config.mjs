// Conventional Commits + a task ID scope, e.g. feat(P1.2): add lint tooling.
// See CLAUDE.md section 8 for the commit convention.
const taskId = (parsed) => {
  const scope = parsed.scope ?? '';
  const ok = /^[A-Z]\d+(\.\d+)?$/.test(scope);
  return [ok, 'scope must be a task ID like P1.2 (see CLAUDE.md)'];
};

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [{ rules: { 'task-id': taskId } }],
  rules: {
    'task-id': [2, 'always'],
    'scope-empty': [2, 'never'],
    'scope-case': [0],
  },
};
