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

## Requirements

- Node.js 18 or newer. Node.js 22.23.1 is used by CI.
- npm, GitHub access, and direct Anthropic or AWS Bedrock access.
- A GitHub token is recommended for higher limits and private repositories.

## Installation

```bash
git clone https://github.com/marceljm/claude-code-multi-agent-orchestrator.git
cd claude-code-multi-agent-orchestrator
npm ci
cp .env.example .env
```

Edit `.env` before running a review.

## Direct Anthropic configuration

```dotenv
ANTHROPIC_API_KEY=sk-ant-your-private-key
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
PROJECT_ROOT=/absolute/path/to/claude-code-multi-agent-orchestrator
REVIEW_MAX_TURNS=80
REVIEW_MAX_BUDGET_USD=1.25
GITHUB_TOKEN=ghp_your-private-token
LOG_LEVEL=info
```

`ANTHROPIC_BASE_URL` must remain unset for direct Anthropic authentication.

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
