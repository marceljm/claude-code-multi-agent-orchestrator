# Review Execution Flow

This document visualizes the runtime flow of the multi-agent pull-request
review system. It complements the architecture decision record for PR-level
specialist batching.

## High-level flow

```mermaid
flowchart TD
    A[CLI invocation] --> B[Validate arguments and environment]
    B --> C[Prepare isolated temporary PR workspace]
    C --> D[Copy trusted .claude configuration]
    D --> O[Start CodeReviewOrchestrator]
    O --> E[Retrieve GitHub MCP evidence]
    O --> F[Invoke ESLint MCP for supported changed files]
    E --> G[Construct one ordered evidence bundle]
    F --> G

    G --> P1
    G --> P2
    G --> P3

    subgraph Parallel[One parallel PR-level specialist batch]
        direction LR
        P1[Code Quality Analyzer]
        P2[Test Coverage Analyzer]
        P3[Refactoring Suggester]
    end

    P1 --> H[Validate and merge specialist results by file path]
    P2 --> H
    P3 --> H
    H --> I[Validate ReviewReport with ReviewReportSchema]
    I --> R[Return validated ReviewReport to CLI]
    R --> J[Write Markdown, HTML, and JSON reports]
    J --> K[Clean up temporary workspace]
    K --> L[Successful completion]

    classDef specialist fill:#e8f1ff,stroke:#356ae6,stroke-width:2px
    class P1,P2,P3 specialist
```

## Runtime sequence

```mermaid
sequenceDiagram
    actor User
    participant CLI
    participant WP as Workspace Preparer
    participant O as Orchestrator
    participant GH as GitHub MCP
    participant EL as ESLint MCP
    participant CQ as Code Quality Analyzer
    participant TC as Test Coverage Analyzer
    participant RS as Refactoring Suggester
    participant RG as Report Generator

    User->>CLI: Invoke review with PR arguments
    CLI->>CLI: Validate arguments and environment
    CLI->>WP: Prepare isolated temporary PR workspace
    WP->>WP: Copy trusted .claude configuration
    WP-->>CLI: Workspace ready
    CLI->>O: Start review in isolated workspace
    O->>GH: Retrieve pull-request evidence (read-only)
    GH-->>O: Changed files and GitHub evidence
    O->>EL: Analyze supported changed files
    EL-->>O: ESLint evidence
    O->>O: Construct one ordered evidence bundle

    par One PR-level call
        O->>CQ: Analyze complete evidence bundle
        CQ-->>O: One result for every changed file
    and One PR-level call
        O->>TC: Analyze complete evidence bundle
        TC-->>O: One result for every changed file
    and One PR-level call
        O->>RS: Analyze complete evidence bundle
        RS-->>O: One result for every changed file
    end

    O->>O: Validate and merge results by file path

    alt Orchestrator returns a validated ReviewReport
        O->>O: Validate final ReviewReport with Zod
        O-->>CLI: Validated ReviewReport

        alt Reports are written successfully
            CLI->>RG: Generate Markdown, HTML, and JSON reports
            RG-->>CLI: Rendered reports
            CLI->>CLI: Write report files
            CLI->>WP: Clean up temporary workspace
            WP-->>CLI: Cleanup complete
            CLI-->>User: Successful completion and report paths
        else Report generation or report writing fails
            CLI->>WP: Attempt workspace cleanup
            WP-->>CLI: Cleanup complete or cleanup failure
            CLI-->>User: Sanitized error and non-zero exit code
        end
    else Review fails
        O-->>CLI: Review failure
        CLI->>WP: Attempt workspace cleanup
        WP-->>CLI: Cleanup complete or cleanup failure
        CLI-->>User: Sanitized error and non-zero exit code
    end
```

## Safety boundaries

The review workspace is temporary and isolated. Target repository scripts and
dependencies are not executed. GitHub MCP usage during analysis is read-only,
and write-capable tools are prohibited. Specialist delegation is limited to the
three configured agents; duplicate specialist invocation aborts the review.

Prompts, patches, source contents, credentials, and tool payloads are not
written to lifecycle logs.
