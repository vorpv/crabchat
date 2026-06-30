# Contributing

## Setup

Install dependencies:

```sh
npm install
```

Copy `.env.example` to `.env` only if you need to override defaults such as `CRABCHAT_HOME`.

## Run

Start the local Next.js development server:

```sh
npm run dev
```

Build a production bundle:

```sh
npm run build
```

Run the production server after building:

```sh
npm run start
```

## Test

Run the normal light test suite:

```sh
npm test
```

Run the full local check used before release-oriented changes:

```sh
npm run check
```

Staging tests use Playwright, Dockerized OpenClaw, and a mock OpenAI-compatible API. They are opt-in and require a real `OPENCLAW_IMAGE` configured in `tests/staging/.env`:

```sh
cp tests/staging/.env.example tests/staging/.env
npm run test:staging
```

For repeated local debugging, use `npm run test:staging:services`, `npm run test:staging:run`, and `npm run test:staging:services:down` separately.

Install the Playwright browser once if it is missing:

```sh
npx playwright install chromium
```
