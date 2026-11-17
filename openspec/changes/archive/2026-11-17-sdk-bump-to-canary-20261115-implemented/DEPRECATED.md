# Implemented

Not planned. Implemented on 2026-11-17.

The extension already pins `@openchamber/sdk` `2.7.2` (commit `b4a80b6`, Renovate PR
#132) and `engines.openchamber >=2.7.1`. The canary moved on to
`2.7.3-canary.20261117.23` with **no new extension-facing SDK surface** (the
`packages/sdk/src` delta against the canary only adds source-control
`commentEdit` and source-control presentation edit fields, which this extension
does not provide), so there is nothing left to adopt. The bump proposal is done.
