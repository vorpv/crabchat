# CrabChat

CrabChat is a local web UI for chatting through an OpenClaw gateway. It provides session browsing, message history, model/reasoning controls, usage display, and configurable CrabChat features.

## Development

Install dependencies:

```sh
npm install
```

Start the Next.js dev server:

```sh
npm run dev
```

Build for production:

```sh
npm run build
```

## Configuration

CrabChat stores local app data in `CRABCHAT_HOME`. If unset, it defaults to `~/.crabchat`.

Copy `.env.example` to `.env` when you want to override the default:

```sh
CRABCHAT_HOME=/home/you/.crabchat
```

Main local files include:

- `crabchat.json`: OpenClaw connection and UI settings.
- `features.json`: togglable CrabChat feature settings.
- `sessions/`: local session snapshots.
- `sessions/archive/`: archived local sessions.

## Features

CrabChat features are configured in `Settings -> Features` and documented in `/features`.

Contributor and agent rules live in `AGENTS.md`.
