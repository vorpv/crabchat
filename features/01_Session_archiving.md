# Session Archiving

## Overview

Session Archiving keeps CrabChat history available when an OpenClaw session is no longer returned by the OpenClaw gateway.

For example, if a session existed locally yesterday but OpenClaw no longer lists it today, CrabChat can move the local copy into archived history instead of dropping it from the session list.

## Configuration

- `archiving.enabled`: configured in `Settings -> Features -> Archiving`.
- Storage: `CRABCHAT_HOME/features.json`.
- Accepted values: `true` or `false`.
- Default: `true`.

When enabled, CrabChat archives missing local sessions during session synchronization.

When disabled, CrabChat does not move missing sessions into the archive during synchronization.

## Details

Session records are stored under `CRABCHAT_HOME/sessions`.

Archived session records are stored under `CRABCHAT_HOME/sessions/archive`.

The feature is managed by CrabChat and uses local session snapshots that were previously synchronized from OpenClaw. It does not delete OpenClaw sessions and does not recreate missing sessions in OpenClaw.

CrabChat treats archiving as a local compatibility layer over OpenClaw session listing behavior. If OpenClaw stops returning a session, CrabChat can still preserve the last locally known metadata and messages in the archive.

If an archived session later appears again in OpenClaw, CrabChat can move the local record back into active session storage during synchronization.

If `CRABCHAT_HOME/features.json` is missing, CrabChat recreates it with the default feature settings.

If `CRABCHAT_HOME/features.json` is malformed, CrabChat falls back to default feature settings at runtime.

## Troubleshooting

If old sessions disappear instead of moving to archived history, check that `archiving.enabled` is `true` in `CRABCHAT_HOME/features.json` or enable Archiving in `Settings -> Features -> Archiving`.

If archived sessions do not appear, check that the `CRABCHAT_HOME/sessions/archive` folder exists and is readable by the CrabChat process.

If the feature toggle appears to reset, check whether `CRABCHAT_HOME` points to a different directory than expected.
