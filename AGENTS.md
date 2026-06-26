# Agent Instructions

These instructions apply to all source contributors and coding agents working in this repository.

## Source Structure

- Keep source files focused and reasonably small.
- When a requested change would make a file bulky, refactor the surrounding code instead of piling more logic into one place.
- Prefer splitting behavior into cohesive modules, components, hooks, helpers, services, or classes that match the existing project structure.
- Expanding class inheritance, composition, or other local abstractions is allowed when it reduces file size, duplication, or conceptual overload.
- Avoid unrelated rewrites. Refactor only the code needed to keep the requested change maintainable.

## Regression Tests

- New behavior and bug fixes should include regression coverage unless the change is purely cosmetic, documentation-only, or otherwise not meaningfully testable.
- Keep tests proportional to the risk and scope of the change. Prefer small unit tests for pure logic, temporary-directory filesystem tests for `CRABCHAT_HOME` behavior, API handler tests for route contracts, and component interaction tests for UI behavior.
- When adding logic inside large UI components, prefer extracting deterministic helpers, hooks, or services so the behavior can be tested without mounting the whole application.
- Do not rely on real OpenClaw, real user data, or a developer's default `CRABCHAT_HOME` in the light test suite. Use mocks and isolated temporary directories for normal regression tests.
- Heavy tests that require a real OpenClaw gateway should be clearly separated from normal test scripts and guarded by explicit environment variables or dedicated commands.
- If a meaningful test cannot be added, explain why in the task summary and mention what manual verification was performed instead.
- Run the relevant test command before finishing a code change. For broad changes, prefer `npm test`; for release-oriented checks, prefer `npm run check` when the environment can support a production build.

## External Libraries

- For large requested features, first check whether a mature external library already solves the core problem.
- Prefer using a well-maintained library for complex domains such as parsing, archive formats, search, storage engines, encryption, rendering, state machines, scheduling, or protocol handling.
- Do not implement large amounts of custom code when a suitable dependency would be smaller, safer, and easier to maintain.
- Before adding a dependency, verify that it fits the project runtime, license expectations, bundle size constraints, and maintenance quality.
- If no suitable library exists, keep the custom implementation modular and document the reasoning in the relevant feature documentation.

## CRABCHAT_HOME Data

`CRABCHAT_HOME` is the application data directory used for local CrabChat state, settings, and persistent user data.

- New files or folders under `CRABCHAT_HOME` may be added when a feature needs to persist new categories of data.
- If the new data is closely related to data already stored in an existing managed file, expand that existing file instead of creating a parallel file.
- For example, settings or state that naturally belongs with the main CrabChat configuration should be added to `crabchat.json` rather than split into a separate config file.
- Every `CRABCHAT_HOME` file or folder used by a feature must be documented in that feature's markdown file under `features/`.
- Documentation must describe what each file or folder stores, who manages it, whether users may edit it manually, and how backward compatibility is handled.

When adding or changing persisted data, update the relevant feature documentation with:

- The file or folder path relative to `CRABCHAT_HOME`.
- The purpose of the data.
- The expected schema or shape, when applicable.
- Migration or compatibility behavior for existing users.
- Failure behavior when the file is missing, malformed, or from an older version.

## Feature Documentation

A CrabChat feature is a user-visible capability that can be toggled and configured from `Settings -> Features`.

CrabChat feature state is stored in `CRABCHAT_HOME/features.json`. Each feature entry should be a named object with at least an `enabled` boolean unless the existing feature schema requires a different shape. Feature-specific options that belong to the feature toggle should live in `features.json`; broader application settings should continue to live in `crabchat.json`.

Every CrabChat feature must also have a user guide file in `/features`. The `/features` folder is maintained by agents and source contributors. It documents CrabChat features from the user's point of view while preserving enough implementation detail for advanced users and future maintainers.

- Create a new numbered markdown file when implementing a new CrabChat feature.
- Update existing feature files when changing behavior, configuration, persistence, compatibility, or troubleshooting details.
- Name files with a leading number and a descriptive title, for example `01_Session_archiving.md`.
- Keep numbering stable once a feature file exists unless there is a clear reason to reorganize the whole folder.
- Do not leave implemented feature behavior undocumented.
- When adding a CrabChat feature, wire it into `Settings -> Features`, persist its feature state in `CRABCHAT_HOME/features.json`, and create or update the matching `/features/*.md` guide.

Each `/features/*.md` file must contain these four top-level sections:

```md
# Feature Name

## Overview

## Configuration

## Details

## Troubleshooting
```

### Overview

Write a short user-facing description of the feature. Include examples when they make the feature easier to understand.

### Configuration

Describe every setting related to the feature that can be changed through the UI or JSON config files.

For each setting, include:

- The setting name.
- Where it is configured, including `Settings -> Features` when it is a feature toggle or feature option.
- Accepted values.
- Default behavior.
- Relevant `CRABCHAT_HOME` file paths, if any.

### Details

Use this section for advanced and implementation-facing information that does not fit the other sections.

Include details such as:

- Backward compatibility with OpenClaw, when relevant.
- Files and folders used by the feature.
- How the system behaves in important edge cases.
- Migration behavior.
- Data retention or cleanup behavior.
- Interaction with other CrabChat features.

### Troubleshooting

This section may be empty for very simple features, but prefer filling it with common failure cases and fixes.

Include known symptoms, likely causes, and practical recovery steps.
