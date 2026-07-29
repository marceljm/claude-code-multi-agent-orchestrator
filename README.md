# Claude Code Multi-Agent Review Orchestrator

A TypeScript command-line application that reviews GitHub pull requests with
the Claude Agent SDK, specialized review agents, Model Context Protocol servers,
runtime schema validation, and deterministic Markdown, HTML, and JSON reports.

## Architecture

The review workflow validates the pull request, collects GitHub and ESLint MCP
evidence, builds one evidence bundle, delegates once in parallel to the Code
Quality Analyzer, Test Coverage Analyzer, and Refactoring Suggester, validates
ordered results with Zod, and writes reports to `reports/`.

The runtime rejects missing, duplicate, unknown, or incorrectly ordered file
results. Specialist delegation is bounded, and duplicate delegation aborts the
review.

### Delegation topology decision

The public specification describes three specialist analyses for every changed
file. This implementation preserves that complete per-file analytical coverage
with three PR-level Task calls rather than `3 × changed-file-count` Task calls.

Each specialist receives the complete ordered changed-file evidence bundle and
returns one result for every changed file. The three specialists still start in
parallel, and missing, duplicate, unknown, malformed, or incorrectly ordered
results fail the complete review.

This is an intentional deviation from the specification’s literal per-file invocation topology. It avoids multiplicative fan-out, repeated evidence,
unbounded turn and API growth, and conflicts with the deterministic
single-specialist and no-retry-after-delegation safety contracts.

The accepted decision, trade-offs, specification mapping, and revisit criteria
are recorded in
[`docs/architecture/0001-pr-level-specialist-batching.md`](docs/architecture/0001-pr-level-specialist-batching.md).

## Requirements

- Node.js 22.x. Node.js 22.23.1 is used by CI and recorded in .nvmrc.
- npm, Git installed on `PATH`, GitHub access, and Udacity Vocareum, direct Anthropic, or AWS Bedrock access.
- A GitHub token is recommended for higher limits and private repositories.

## Installation

```bash
git clone https://github.com/marceljm/claude-code-multi-agent-orchestrator.git
cd claude-code-multi-agent-orchestrator
npm ci
cp .env.example .env
```

Edit `.env` before running a review.

## Udacity Vocareum configuration

```dotenv
ANTHROPIC_API_KEY=<your-udacity-api-key>
ANTHROPIC_BASE_URL=https://claude.vocareum.com
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
PROJECT_ROOT=/absolute/path/to/claude-code-multi-agent-orchestrator
```

The API key is supplied by Udacity and must remain private.

## Direct Anthropic configuration

```dotenv
ANTHROPIC_API_KEY=<your-personal-anthropic-api-key>
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
PROJECT_ROOT=/absolute/path/to/claude-code-multi-agent-orchestrator
REVIEW_MAX_TURNS=80
REVIEW_MAX_BUDGET_USD=1.25
GITHUB_TOKEN=ghp_your-private-token
LOG_LEVEL=info
```

`ANTHROPIC_BASE_URL` must be unset when using a personal Anthropic API key.

## AWS Bedrock configuration

```dotenv
CLAUDE_CODE_USE_BEDROCK=1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_REGION=us-east-1
ANTHROPIC_MODEL=your-bedrock-compatible-model
PROJECT_ROOT=/absolute/path/to/claude-code-multi-agent-orchestrator
```

Do not configure `ANTHROPIC_API_KEY` when using Bedrock.

## Running a review

```bash
npm run dev -- <owner> <repository> <pull-request-number>
npm run build
npm start -- <owner> <repository> <pull-request-number>
```

Example: `npm run dev -- airaamane simple-todo-app 2`.

## Local review workspace

`PROJECT_ROOT` is the absolute path to the installed orchestrator repository,
which contains its trusted `.claude` directory. The CLI automatically creates
an isolated temporary checkout of `pull/<number>/head`, installs trusted Claude
skills, writes reports under the invocation directory, and removes the checkout
after success or failure. Users do not need to prepare the target repository.

`GITHUB_TOKEN` is optional for public repositories and may be needed for private
ones. It is supplied to Git fetch through temporary configuration and is not
embedded in the URL or persisted in `.git/config`. Target dependencies are not
installed and repository scripts are not executed.

## Review specialists

### Code Quality Analyzer

Reviews security, performance, maintainability, style, bug risk, and modern
best practices. Before analysis it invokes `security-analysis` for every review,
`typescript-patterns` when TypeScript files are present, and
`javascript-best-practices` when JavaScript files are present.

### Test Coverage Analyzer

Identifies existing tests, missing paths, edge cases, and prioritized tests.

### Refactoring Suggester

Produces evidence-based refactoring opportunities with impact and examples.

## Claude Skills

The code-quality specialist has access to three repository skills:

- `security-analysis` for every assigned changed file.
- `typescript-patterns` for `.ts`, `.tsx`, `.mts`, and `.cts` files.
- `javascript-best-practices` for `.js`, `.jsx`, `.mjs`, and `.cjs` files.

Each applicable skill is invoked exactly once before code analysis. The
test-coverage and refactoring specialists intentionally do not receive the
`Skill` tool.

## Runtime rate limiting

Every complete review is admitted through a process-wide rate limiter before the
Claude Agent SDK query begins. The reservation remains active while the SDK
stream is consumed and while the structured report is validated, and it is
released on both success and failure.

The default limits are:

- 50 admitted reviews per rolling minute.
- 100,000 estimated tokens per rolling minute.
- Five concurrent reviews.
- 1,000 estimated tokens reserved per review.

CLI execution uses the shared `globalRateLimiter`. Programmatic callers may
inject an isolated `RateLimiter` and a different positive
`estimatedTokensPerReview` value through `OrchestratorOptions`.

## Retry and timeout safety

Each Agent SDK execution attempt has a five-minute timeout. A timed-out attempt
is aborted through its SDK `AbortController`.

A transient startup failure may be retried only when the SDK has not emitted a
stream message and no specialist delegation has begun. The default is two
retries after the initial attempt, for at most three total attempts, using
exponential backoff with a one-second initial delay.

Once any SDK stream message is observed, any specialist begins, or a delegation
safety violation occurs, the complete review fails without retry. This prevents
a retry from invoking a specialist more than once.

The process-wide rate-limit reservation remains held across all safe retry
attempts and backoff delays for the complete review. Programmatic callers may
override `reviewTimeoutMs`, `maxPreDelegationRetries`, and `retryDelayMs` through
`OrchestratorOptions`.

## Structured lifecycle logging

The CLI and orchestrator emit structured lifecycle events through Winston.
Production events are written as JSON to `logs/combined.log`, while errors are
also written to `logs/error.log`. Non-production execution also receives the
existing console transport.

Lifecycle events cover CLI initialization, rate-limit admission, SDK attempts,
safe retry decisions, specialist delegation, first stream activity, review
completion or failure, and report writing.

Every event includes an `event` identifier and relevant structured fields such
as repository identity, attempt number, duration, result counts, or a sanitized
error name, message, and code. `LOG_LEVEL` controls the minimum emitted level.

Lifecycle logging never includes credentials, environment contents, prompts,
patches, source contents, tool payloads, SDK message bodies, structured report
bodies, or generated report contents. Programmatic callers may inject a
`StructuredLogger` through `OrchestratorOptions` or `CliDependencies`.

## MCP servers

- GitHub MCP for pull-request and repository operations.
- ESLint MCP for linting and static-analysis operations.

`GITHUB_TOKEN` is mapped to the environment expected by the GitHub MCP server.

## Reports included in this repository

Required reports for pull requests 1, 2, and 3 are committed in Markdown, HTML,
and JSON. Other generated reports remain ignored by Git.

## Offline validation

```bash
npm run build
npm run lint
npm run test:integration
npm run test:ci
```

CI uses Node.js 22.23.1 and explicitly disables every live-test gate.

## Opt-in live tests

Live tests can make external requests and consume API credits. They remain
disabled unless their corresponding environment gate equals `1`.

```text
npm run test:live
npm run test:live:cli
npm run test:live:reports
npm run test:live:anthropic-credit
npm run test:live:anthropic-structured-output
```

## Core technologies

- Claude Agent SDK
- Model Context Protocol
- TypeScript
- Zod 4 and Draft 7 JSON Schema
- Vitest
- Winston

The code-quality analyzer loads the security skill and every applicable language
skill before analysis. CI runs offline with all live gates explicitly disabled.
