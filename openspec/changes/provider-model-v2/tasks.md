# Tasks

## 1. Data layer v2

- [x] 1.1 Extend the maintenance provider-catalog flow to emit v2 per-model entries with free/non-free variants and costs, alongside the existing v1 writes.
- [x] 1.2 Verify v1 and v2 artifacts coexist during the transition.

## 2. Task types v2

- [x] 2.1 Move task entries to task -> model id references in v2; keep v1 task entries.

## 3. Shared selection base

- [x] 3.1 Extend the shared selection core with task -> model -> variant resolution.
- [x] 3.2 Vendor the v2 path into the plugin, extension and action copies.

## 4. Runtime selection

- [x] 4.1 Apply free-first or go-first at runtime; prefer engine provider variants on equal cost+score.

## 5. Documentation

- [x] 5.1 Add the README section and move model/provider tables into referenced Markdown files.
