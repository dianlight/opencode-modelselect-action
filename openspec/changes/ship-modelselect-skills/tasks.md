# Tasks

## 1. Skill

- [ ] 1.1 Create `openchamber-modelselect/skills/modelselect/SKILL.md` covering the task-type mapping, the routing flow and the Work Status section
- [ ] 1.2 Add `contributes.skills` to `openchamber-modelselect/package.json` and verify the manifest parses
- [ ] 1.3 Run `bun run check` and `bun run test` and verify the skill folder is accepted

## 2. Sync and docs

- [ ] 2.1 Add a maintenance check that fails when a task type in `config/task-types.yaml` is missing from the skill text
- [ ] 2.2 Document the skill in `openchamber-modelselect/README.md`
- [ ] 2.3 Rebuild the bundles and verify `bun run check`
