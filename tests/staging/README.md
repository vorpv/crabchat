# Staging Tests

This folder contains opt-in tests for CrabChat against a real Dockerized OpenClaw gateway and a local mock OpenAI-compatible API.

The normal `npm test` suite does not use this harness. Staging tests are intended for local advanced testing and CI jobs that can run Docker and browser automation.

## Setup

Copy the example env file and set the OpenClaw image that should be tested:

```sh
cp tests/staging/.env.example tests/staging/.env
```

Install the Playwright browser once on machines that do not already have it:

```sh
npx playwright install chromium
```

The compose file starts:

- `mock-openai`: a deterministic OpenAI-compatible HTTP API at `http://127.0.0.1:8080/v1`.
- `openclaw`: the Docker image from `OPENCLAW_IMAGE`, exposed at `ws://127.0.0.1:18789`.

The compose file passes several common OpenAI and gateway environment variables into OpenClaw. If the target OpenClaw image uses a different configuration contract, update `tests/staging/docker-compose.yml` rather than changing the light test suite.

## Running

Run the full staging suite. This starts services, runs Playwright, and then stops services even when Playwright fails:

```sh
npm run test:staging
```

For local iteration, start the Docker services:

```sh
npm run test:staging:services
```

Run Playwright against the already-running services:

```sh
npm run test:staging:run
```

Stop the Docker services:

```sh
npm run test:staging:services:down
```

`npm run test:staging` and `npm run test:staging:run` prepare an isolated `CRABCHAT_HOME` at `/tmp/outclaw-staging/crabchat-home` by default. Override these values when needed:

```sh
CRABCHAT_STAGING_HOME=/tmp/my-crabchat-home \
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789 \
OPENCLAW_GATEWAY_TOKEN=test-token \
npm run test:staging:run
```

Set `CRABCHAT_STAGING_KEEP_HOME=1` to reuse the same test home across runs.
