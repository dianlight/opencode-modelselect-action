# Tasks

## 1. Limit source

- [ ] 1.1 Add a sim scenario with gateway `context_length` and `max_completion_tokens` and verify the budget uses them

## 2. Remove constants

- [ ] 2.1 Remove the hard-coded virtual limits from `plugin/src/v2.js` and verify a catalog miss records a ledger entry instead
- [ ] 2.2 Verify `config/model-capabilities.yaml` remains the curated override only

## 3. Documentation

- [ ] 3.1 Document the gateway limit source in the extension README and verify the fallback is labeled
