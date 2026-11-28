# Tasks

## 1. Agreement contract

- [ ] 1.1 Add a sim scenario where a lead dispatches without an agreement and verify the dispatch is held until a model is picked
- [ ] 1.2 Add a scenario where an explicit agreement exists and verify the subagent inherits it

## 2. Remove inference

- [ ] 2.1 Replace `PROMPT_RULES`/`ACK_WORDS` delegation hints in `plugin/src/shared/detect.js` and verify no delegated turn carries an inferred model
- [ ] 2.2 Drop the `[modelselect: …]` annotation from delegated prompt hooks in `plugin/src/v2.js` and verify the prompt text is unchanged

## 3. Documentation

- [ ] 3.1 Document the lead agreement flow in the extension README and verify the wording matches the 11-28 canary behavior
