# Tasks

## 1. Signal integration

- [ ] 1.1 Add a sim scenario where the host reports the plugin loaded and verify no setup action is offered

## 2. Remove sniffing

- [ ] 2.1 Remove the JSONC tokenizer and `/modelselect/i` sniffing from `service/src/store.js` and verify no config file read remains in that path
- [ ] 2.2 Verify the missing-plugin case still shows the setup action

## 3. Documentation

- [ ] 3.1 Document the new signal source in the extension README and verify `plugin-switched-off-state` is not marked outdated
