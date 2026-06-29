# Notes

## Overview

Notes lets CrabChat keep reusable text snippets and unsent prompt drafts as local files. When enabled, the Notes button in the chat header opens a right-side panel block with saved notes. Notes can be filtered by agent, edited in a modal, sent back to the prompt composer, or removed from disk.

Prompt drafts can also be saved automatically. Draft prompt files are hidden from the Notes list and are deleted once OpenClaw accepts the message.

## Configuration

- `notes.enabled`: configured in `Settings -> Features -> Notes`. Accepted values are `true` and `false`. Default is `true`.
- `notes.autoSavePrompts`: configured in `Settings -> Features -> Notes`. Accepted values are `true` and `false`. Default is `true`. When enabled, current prompt text is persisted as a hidden `.prompt` file until it is sent successfully or cleared.
- `notes.manualPromptSaving`: configured in `Settings -> Features -> Notes`. Accepted values are `true` and `false`. Default is `false`. When enabled, a note button appears beside Send in the prompt composer.
- `notes.useMonospaceFont`: configured in `Settings -> Features -> Notes`. Accepted values are `true` and `false`. Default is `false`. When enabled, the note editor text area uses CrabChat's monospace font.
- `notes.storagePath`: configured in `Settings -> Features -> Notes` as `Store notes at`. Accepted value is an empty string or an absolute folder path. Default is an empty string, which stores notes under `CRABCHAT_HOME/notes`.

Storage state is persisted in `CRABCHAT_HOME/features.json`. Note files are not stored in `features.json`; they are stored as individual files in the configured notes folder.

## Details

Default storage is `CRABCHAT_HOME/notes`. A custom `notes.storagePath` must be an existing readable and writable folder, or a not-yet-existing folder whose parent exists and is readable and writable. CrabChat creates the configured folder only when the first note is saved.

If the storage path changes and notes already exist, CrabChat moves existing `.txt` and `.prompt` note files into the new folder and removes the old folder when it becomes empty.

Each note is a separate file. Normal notes use `.txt`; prompt drafts use `.prompt`. Filenames follow:

- `{title}_._.{agent}.txt` when an agent is assigned.
- `{title}..txt` when no agent is assigned.
- The private `untitled` title is used when a note has no title.
- Dots inside title or agent values are encoded as `_._`.

CrabChat reads file modified time to sort notes by last update. Notes are cached in the panel while it is open; use Reload to re-read files from disk.

Before saving an edited note, CrabChat checks whether the disk file changed since the editor loaded it. If an external edit is detected, the editor offers Load from disk, Overwrite disk version, or Save as separate note.

## Troubleshooting

If Save is disabled in the feature settings, check `Store notes at`. Custom paths must be absolute and must point to a writable folder or to a creatable folder under a writable parent.

If a note does not appear in the Notes list, it may be a `.prompt` draft. Prompt drafts are intentionally hidden until edited as normal notes.

If external edits are not visible, use the Reload button in the Notes panel.
