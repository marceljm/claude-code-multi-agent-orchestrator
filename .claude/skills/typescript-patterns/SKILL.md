---
description: Reviews TypeScript for type safety, sound narrowing, API design, generics, async correctness, and maintainable patterns
---

# TypeScript Patterns

Apply this guidance to `.ts`, `.tsx`, `.mts`, and `.cts` files.

Focus on defects that affect correctness, maintainability, testability, or the
clarity of public contracts. Do not report purely stylistic preferences.

## Type Safety

- Prefer `unknown` over `any` at untrusted or external boundaries.
- Narrow `unknown` before reading properties, invoking methods, or casting.
- Avoid broad type assertions that bypass compiler checks.
- Treat non-null assertions as suspicious unless an invariant is proven nearby.
- Preserve strict nullability instead of hiding `null` or `undefined`.
- Prefer discriminated unions for mutually exclusive variants.
- Use exhaustive checks when every union member must be handled.
- Avoid wrapper object types such as `String`, `Number`, and `Boolean`.
- Prefer precise return types for exported functions and public methods.
- Keep runtime behavior aligned with declared types.

```typescript
function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
```

## Narrowing and Runtime Validation

Static types do not validate runtime data.

- Validate JSON, environment variables, HTTP payloads, database rows, and tool
  output before trusting them.
- Use `typeof`, `instanceof`, property checks, predicates, or schema validation.
- Ensure custom type guards actually prove the returned predicate.
- Do not cast unvalidated external data directly to an application type.
- Distinguish optional properties from properties whose value may be undefined.
- Preserve narrowing across callbacks and asynchronous boundaries.
- Check array and record contents, not only the outer container.

## API and Data Modeling

- Use interfaces or type aliases consistently with project conventions.
- Prefer readonly data when mutation is not part of the contract.
- Model invalid states out of the type system when practical.
- Use literal unions instead of unconstrained strings for closed value sets.
- Keep public types focused and avoid leaked implementation details.
- Avoid excessively broad index signatures.
- Prefer `satisfies` without widening inferred values.
- Preserve exact optional-property semantics where the project enables them.
- Avoid duplicated types that can drift from runtime schemas.

## Generics

- Add generics only when they express a real relationship between values.
- Constrain type parameters when callers require specific capabilities.
- Avoid unused or single-use parameters that add no safety.
- Preserve inference instead of requiring unnecessary explicit arguments.
- Do not return unconstrained generic values that cannot be created safely.
- Use `keyof` and mapped types only when they improve clarity.
- Avoid conditional-type complexity that obscures the public contract.
- Verify generic defaults do not widen values unexpectedly.

## Async and Error Handling

- Type asynchronous return values as `Promise<T>`.
- Await operations whose failure or completion matters.
- Avoid floating promises unless intentionally detached and handled.
- Avoid mixing callback and Promise completion paths.
- Use `Promise.all` only when failing the whole group is appropriate.
- Preserve original errors or attach useful context when wrapping them.
- Narrow caught values because a caught value may not be an `Error`.
- Ensure concurrent operations have intentional failure semantics.
- Use settled-result handling when independent failures must be retained.
- Propagate cancellation or abort signals through long-running operations.

## React and TSX

For `.tsx` files:

- Type component props explicitly.
- Avoid array indexes as keys for mutable lists.
- Preserve event types instead of casting event targets.
- Treat state as immutable.
- Avoid effects with missing or unstable dependencies.
- Do not store derived values in state without a clear reason.
- Verify nullable refs before dereferencing them.
- Keep component public props narrower than internal implementation state.

## Common Risk Patterns

Report these when supported by code evidence:

- `any` spreading through a public API.
- Unsafe `as` casts at input boundaries.
- Non-null assertions masking a reachable null state.
- Switches silently ignoring a new union member.
- Runtime schemas and TypeScript types disagreeing.
- Optional properties used as though always present.
- Generic helpers returning a type they cannot guarantee.
- Unhandled promise rejection paths.
- Synchronous functions returning Promise-like work.
- Mutation of values expected to be immutable.
- Incorrect ESM extension or module-resolution assumptions.
- Importing a value only for use as a type when type-only imports are required.
- Public declarations inferred from unstable implementation details.

## Severity Guidance

- `critical`: Type escapes enable severe security impact or data loss.
- `high`: Reachable defects cause incorrect production behavior or outage.
- `medium`: Realistic runtime failure or incomplete handling.
- `low`: Limited safety or maintainability weakness.
- `info`: Useful improvement without a demonstrated defect.

## Output

For each supported finding provide:

1. The exact file and actual line.
2. The unsafe or unclear TypeScript pattern.
3. The evidence that makes it relevant.
4. The runtime or maintenance impact.
5. A concrete, type-safe correction.
6. A justified severity.

Return no finding when the existing TypeScript is sound.
