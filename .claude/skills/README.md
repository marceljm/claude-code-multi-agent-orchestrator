# Claude Skills

This directory contains reusable domain guidance loaded by the Claude Agent SDK.

## Installed skill

### `javascript-best-practices`

The code-quality analyzer invokes this skill before analyzing a pull request.
It covers modern JavaScript, async usage, pitfalls, performance, security, and
actionable severity-based findings.

The skill is stored at `.claude/skills/javascript-best-practices/SKILL.md`.

## Runtime use

The code-quality analyzer has access to the `Skill` tool. Its prompt requires
`javascript-best-practices` to be the first tool invocation, ensuring that the
skill guidance is loaded before the analyzer returns its structured result.

The test-coverage analyzer and refactoring suggester do not use skills. Their
tool sets remain intentionally smaller.

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

Add a new directory under `.claude/skills/`, create its `SKILL.md`, expose the
`Skill` tool only to the agent that needs it, and add focused tests for the
prompt and tool contract.
