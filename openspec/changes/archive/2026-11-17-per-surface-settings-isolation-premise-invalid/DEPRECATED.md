# Deprecated

Not implemented. Deprecated on 2026-11-17: premise does not hold.

The proposal moves plugin options into a host "per-surface settings store" said to
arrive with OpenChamber 2.7.3. Verified against the SDK surface diff between
v2.7.2 and the 2026-11-17 canary (`packages/sdk/DOCUMENTATION.md`,
`GUEST_SERVICES.md`, all of `packages/sdk/src`): no per-surface settings store,
key or manifest field exists. The 2.7.3 host changes that mention settings are the
app's own settings UI, not an extension API. With no contract to store into, the
change has nothing to implement; `options-out-of-opencode-config` remains the
owner of where plugin options live.
