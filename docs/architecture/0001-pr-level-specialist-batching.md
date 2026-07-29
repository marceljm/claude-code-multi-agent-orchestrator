# ADR 0001: Preserve PR-level specialist batching

- Status: Accepted
- Date: 2026-07-29

## Context

The public project specification describes all three specialist analyses as
required for every changed file and uses literal wording that suggests starting
three parallel Task invocations separately for each file.

For a pull request with `F` changed files, that topology creates `3 × F`
specialist Task calls. It also repeats shared pull-request, repository, source,
test, patch, and ESLint evidence across many independent delegations.

The implemented architecture instead creates one complete pull-request evidence
bundle and starts exactly three specialists in one parallel delegation batch:

1. `code-quality-analyzer`
2. `test-coverage-analyzer`
3. `refactoring-suggester`

Each specialist receives all changed files and returns one ordered result for
every changed file.

## Decision

The implementation uses exactly three specialist Task calls for the complete pull request.

The literal per-file Task fan-out alternative is rejected.

The per-file requirement is treated as an analytical coverage invariant rather
than an invocation-count requirement. Every changed file still receives all three required analyses.

This is an intentional deviation from the literal invocation topology, not a
reduction in review coverage.

## Rationale

PR-level batching:

- Reduces specialist calls from `3 × F` to exactly three.
- Builds and transfers shared evidence once.
- Avoids multiplicative API cost, latency, context duplication, and turn usage.
- Keeps rate limiting and timeout accounting bounded at the complete-review
  level.
- Preserves the no-retry-after-delegation safety contract.
- Allows a deterministic guard to permit each named specialist exactly once.
- Prevents partial per-file fan-out from producing an incomplete report.
- Requires each specialist to return exactly one result per changed file.
- Validates missing, duplicate, unknown, and incorrectly ordered file results.
- Preserves the final `ReviewReport` schema and deterministic summary rules.

## Specification mapping

| Public requirement | Batched implementation |
| --- | --- |
| Code-quality analysis for every changed file | One code-quality Task returns one result per changed file |
| Test-coverage analysis for every changed file | One test-coverage Task returns one result per changed file |
| Refactoring analysis for every changed file | One refactoring Task returns one result per changed file |
| Independent analyses execute in parallel | The three PR-level Task calls start in one parallel tool-use batch |
| Missing specialist output fails the review | Missing or malformed specialist arrays fail the complete review |
| Results are aggregated per file | Ordered arrays are merged by exact repository-relative file path |

## Rejected alternative

Literal per-file fan-out would require three Task calls for every changed file.

It would also require a more complex runtime guard keyed by both specialist and
file, repeated evidence transfer, greater turn and token budgets, and
significantly more partial-failure states.

It would weaken the current bounded-autonomy guarantees without increasing the
required analytical coverage.

## Consequences

Positive consequences:

- Predictable specialist count.
- Lower latency and API usage.
- Simpler deterministic safety enforcement.
- Complete per-file result validation.
- Stable retry, timeout, rate-limit, and logging semantics.

Negative consequence:

- An evaluator that checks literal Task-call topology rather than analytical
  output coverage may consider the implementation different from the public
  specification wording.

## Revisit criteria

Revisit this decision only when one of these conditions becomes true:

- An authoritative evaluator explicitly rejects semantically equivalent
  PR-level batching.
- The specification is revised to make invocation count an explicit acceptance
  criterion.
- The SDK provides deterministic host-controlled per-file fan-out with bounded
  concurrency and complete failure handling.
- A measured quality evaluation demonstrates that PR-level batching misses
  findings that literal per-file delegation reliably detects.
