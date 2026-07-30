# Claude Skills

This directory contains reusable domain guidance loaded by the Claude Agent SDK.

## Installed skills

### `javascript-best-practices`

Reviews JavaScript files for modern syntax, async usage, pitfalls, performance,
security, and actionable best practices.

The skill is stored at `.claude/skills/javascript-best-practices/SKILL.md`.

### `typescript-patterns`

Reviews TypeScript files for type safety, narrowing, runtime validation, API
design, generics, async correctness, and maintainable patterns.

Stored at `.claude/skills/typescript-patterns/SKILL.md`.

### `security-analysis`

Reviews every assigned changed file for OWASP-aligned security risks, trust
boundaries, injection, authorization flaws, secret exposure, and availability.

Stored at `.claude/skills/security-analysis/SKILL.md`.

## Runtime use

All three required specialists include the `Skill` tool and can access this
repository's Claude skills library.

The code-quality analyzer has mandatory Skill-selection rules. Security
guidance is required for every review. TypeScript guidance is required for
`.ts`, `.tsx`, `.mts`, and `.cts` files. JavaScript guidance is required for
`.js`, `.jsx`, `.mjs`, and `.cjs` files. Each applicable code-quality Skill is
invoked exactly once before analysis begins.

Security guidance is required for every review.
TypeScript guidance is required when TypeScript files are present.
JavaScript guidance is required when JavaScript files are present.

The test-coverage analyzer and refactoring suggester may consult relevant
installed Skills when useful for their assigned role. They remain read-only,
must not invoke another agent, and must still return exactly one result for
every assigned changed file.

## Skill format

A skill is stored in its own directory as `SKILL.md`:

```markdown
---
description: Concise description of the skill
---

# Skill name

Domain guidance and review rules.

## Output

Expected guidance or response format.
```

## Adding another skill

Add a new directory under `.claude/skills/`, create its `SKILL.md`, document
which specialists should use it, and add focused tests for the prompt and tool
contract.
