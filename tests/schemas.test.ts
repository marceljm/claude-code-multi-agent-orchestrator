import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import {
  CodeQualityResultJSONSchema,
  CodeQualityResultSchema,
  RefactoringSuggestionJSONSchema,
  RefactoringSuggestionSchema,
  ReviewReportJSONSchema,
  ReviewReportSchema,
  TestCoverageResultJSONSchema,
  TestCoverageResultSchema
} from '../src/types/index.js';

const createCodeQualityIssue = () => ({
  line: 12,
  severity: 'high' as const,
  category: 'security' as const,
  description: 'User input is used without sufficient validation.',
  suggestion: 'Validate and sanitize the input before using it.'
});

const createCodeQualityResult = () => ({
  file: 'src/services/user-service.ts',
  issues: [createCodeQualityIssue()],
  overallScore: 72,
  summary: 'The file is generally maintainable but contains a security concern.'
});

const createUntestedPath = () => ({
  type: 'branch' as const,
  location: 'src/services/user-service.ts:20-28',
  priority: 'high' as const,
  reasoning: 'The error branch is not exercised by the current tests.',
  suggestedTest: 'Add a test that verifies invalid input returns the expected error.'
});

const createTestCoverageResult = () => ({
  file: 'src/services/user-service.ts',
  hasTests: true,
  testFiles: ['tests/user-service.test.ts'],
  untestedPaths: [createUntestedPath()],
  coverageEstimate: 65,
  summary: 'The main success path is tested, but an important error branch is missing.'
});

const createRefactoringEntry = () => ({
  type: 'extract-function' as const,
  location: 'src/services/user-service.ts:10-35',
  impact: 'medium' as const,
  description: 'Extract the input-validation block into a named function.',
  before: 'if (!input.name || input.name.trim() === "") { /* ... */ }',
  after: 'validateUserInput(input);',
  benefits: 'Improves readability, reuse, and isolated testability.'
});

const createRefactoringResult = () => ({
  file: 'src/services/user-service.ts',
  suggestions: [createRefactoringEntry()],
  summary: 'A small extraction would make the main operation easier to understand.'
});

const createReviewReport = () => ({
  pullRequest: {
    owner: 'example-owner',
    repo: 'example-repository',
    number: 42
  },
  fileReviews: [
    {
      file: 'src/services/user-service.ts',
      codeQuality: createCodeQualityResult(),
      testCoverage: createTestCoverageResult(),
      refactorings: createRefactoringResult()
    }
  ],
  summary: {
    totalFiles: 1,
    overallScore: 72,
    criticalIssues: 0,
    highPriorityTests: 1,
    refactoringOpportunities: 1
  },
  recommendations: [
    {
      priority: 'high' as const,
      category: 'security',
      description: 'Validate external input before processing it.',
      files: ['src/services/user-service.ts']
    }
  ],
  metadata: {
    analyzedAt: '2026-07-27T20:00:00.000Z',
    duration: 1250,
    agentVersions: {
      orchestrator: 'claude-sonnet',
      codeQualityAnalyzer: 'inherit',
      testCoverageAnalyzer: 'inherit',
      refactoringSuggester: 'inherit'
    }
  }
});

type JSONSchemaObject = {
  type?: unknown;
  properties?: unknown;
  required?: unknown;
};

function expectObjectJSONSchema(
  schema: Record<string, unknown>,
  requiredProperties: string[]
): void {
  const objectSchema = schema as JSONSchemaObject;

  expect(objectSchema.type).toBe('object');
  expect(objectSchema.properties).toBeTruthy();
  expect(Array.isArray(objectSchema.properties)).toBe(false);

  const properties = objectSchema.properties as Record<string, unknown>;

  expect(Object.keys(properties)).toEqual(
    expect.arrayContaining(requiredProperties)
  );

  expect(objectSchema.required).toEqual(
    expect.arrayContaining(requiredProperties)
  );

  expect(() => JSON.stringify(schema)).not.toThrow();
  expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
}

describe('CodeQualityResultSchema', () => {
  it('accepts a complete valid code-quality result', () => {
    const result = createCodeQualityResult();

    expect(CodeQualityResultSchema.parse(result)).toEqual(result);
  });

  it('accepts an empty issues array', () => {
    const result = {
      ...createCodeQualityResult(),
      issues: []
    };

    expect(CodeQualityResultSchema.parse(result)).toEqual(result);
  });

  it.each([0, 100])(
    'accepts the overallScore boundary value %i',
    overallScore => {
      const result = {
        ...createCodeQualityResult(),
        overallScore
      };

      expect(CodeQualityResultSchema.parse(result)).toEqual(result);
    }
  );

  it.each([-1, 101])(
    'rejects the out-of-range overallScore value %i',
    overallScore => {
      const result = {
        ...createCodeQualityResult(),
        overallScore
      };

      expect(() => CodeQualityResultSchema.parse(result)).toThrow(ZodError);
    }
  );

  it('rejects an invalid severity', () => {
    const result = {
      ...createCodeQualityResult(),
      issues: [
        {
          ...createCodeQualityIssue(),
          severity: 'urgent'
        }
      ]
    };

    expect(() => CodeQualityResultSchema.parse(result)).toThrow(ZodError);
  });

  it('rejects an invalid category', () => {
    const result = {
      ...createCodeQualityResult(),
      issues: [
        {
          ...createCodeQualityIssue(),
          category: 'documentation'
        }
      ]
    };

    expect(() => CodeQualityResultSchema.parse(result)).toThrow(ZodError);
  });

  it('rejects a non-numeric issue line', () => {
    const result = {
      ...createCodeQualityResult(),
      issues: [
        {
          ...createCodeQualityIssue(),
          line: '12'
        }
      ]
    };

    expect(() => CodeQualityResultSchema.parse(result)).toThrow(ZodError);
  });

  it('rejects a missing required file field', () => {
    const { file: _file, ...resultWithoutFile } = createCodeQualityResult();

    expect(() => CodeQualityResultSchema.parse(resultWithoutFile)).toThrow(
      ZodError
    );
  });
});

describe('TestCoverageResultSchema', () => {
  it('accepts a complete valid test-coverage result', () => {
    const result = createTestCoverageResult();

    expect(TestCoverageResultSchema.parse(result)).toEqual(result);
  });

  it('accepts empty testFiles and untestedPaths arrays', () => {
    const result = {
      ...createTestCoverageResult(),
      hasTests: false,
      testFiles: [],
      untestedPaths: []
    };

    expect(TestCoverageResultSchema.parse(result)).toEqual(result);
  });

  it.each([0, 100])(
    'accepts the coverageEstimate boundary value %i',
    coverageEstimate => {
      const result = {
        ...createTestCoverageResult(),
        coverageEstimate
      };

      expect(TestCoverageResultSchema.parse(result)).toEqual(result);
    }
  );

  it.each([-1, 101])(
    'rejects the out-of-range coverageEstimate value %i',
    coverageEstimate => {
      const result = {
        ...createTestCoverageResult(),
        coverageEstimate
      };

      expect(() => TestCoverageResultSchema.parse(result)).toThrow(ZodError);
    }
  );

  it('rejects a non-boolean hasTests value', () => {
    const result = {
      ...createTestCoverageResult(),
      hasTests: 'yes'
    };

    expect(() => TestCoverageResultSchema.parse(result)).toThrow(ZodError);
  });

  it('rejects an invalid untested-path type', () => {
    const result = {
      ...createTestCoverageResult(),
      untestedPaths: [
        {
          ...createUntestedPath(),
          type: 'statement'
        }
      ]
    };

    expect(() => TestCoverageResultSchema.parse(result)).toThrow(ZodError);
  });

  it('rejects an invalid untested-path priority', () => {
    const result = {
      ...createTestCoverageResult(),
      untestedPaths: [
        {
          ...createUntestedPath(),
          priority: 'info'
        }
      ]
    };

    expect(() => TestCoverageResultSchema.parse(result)).toThrow(ZodError);
  });

  it('rejects a missing required summary field', () => {
    const { summary: _summary, ...resultWithoutSummary } =
      createTestCoverageResult();

    expect(() => TestCoverageResultSchema.parse(resultWithoutSummary)).toThrow(
      ZodError
    );
  });
});

describe('RefactoringSuggestionSchema', () => {
  it('accepts a complete valid refactoring result', () => {
    const result = createRefactoringResult();

    expect(RefactoringSuggestionSchema.parse(result)).toEqual(result);
  });

  it('accepts an empty suggestions array', () => {
    const result = {
      ...createRefactoringResult(),
      suggestions: []
    };

    expect(RefactoringSuggestionSchema.parse(result)).toEqual(result);
  });

  it('rejects an invalid refactoring type', () => {
    const result = {
      ...createRefactoringResult(),
      suggestions: [
        {
          ...createRefactoringEntry(),
          type: 'rewrite-everything'
        }
      ]
    };

    expect(() => RefactoringSuggestionSchema.parse(result)).toThrow(ZodError);
  });

  it('rejects an invalid impact', () => {
    const result = {
      ...createRefactoringResult(),
      suggestions: [
        {
          ...createRefactoringEntry(),
          impact: 'critical'
        }
      ]
    };

    expect(() => RefactoringSuggestionSchema.parse(result)).toThrow(ZodError);
  });

  it('rejects a suggestion missing its before example', () => {
    const { before: _before, ...suggestionWithoutBefore } =
      createRefactoringEntry();

    const result = {
      ...createRefactoringResult(),
      suggestions: [suggestionWithoutBefore]
    };

    expect(() => RefactoringSuggestionSchema.parse(result)).toThrow(ZodError);
  });

  it('rejects a missing required file field', () => {
    const { file: _file, ...resultWithoutFile } = createRefactoringResult();

    expect(() => RefactoringSuggestionSchema.parse(resultWithoutFile)).toThrow(
      ZodError
    );
  });
});

describe('ReviewReportSchema', () => {
  it('accepts a complete valid review report', () => {
    const report = createReviewReport();

    expect(ReviewReportSchema.parse(report)).toEqual(report);
  });

  it('accepts empty fileReviews and recommendations arrays', () => {
    const report = {
      ...createReviewReport(),
      fileReviews: [],
      summary: {
        totalFiles: 0,
        overallScore: 100,
        criticalIssues: 0,
        highPriorityTests: 0,
        refactoringOpportunities: 0
      },
      recommendations: []
    };

    expect(ReviewReportSchema.parse(report)).toEqual(report);
  });

  it('rejects a missing required metadata field', () => {
    const { metadata: _metadata, ...reportWithoutMetadata } =
      createReviewReport();

    expect(() => ReviewReportSchema.parse(reportWithoutMetadata)).toThrow(
      ZodError
    );
  });

  it('rejects an invalid recommendation priority', () => {
    const report = {
      ...createReviewReport(),
      recommendations: [
        {
          priority: 'info',
          category: 'style',
          description: 'Example recommendation.',
          files: ['src/example.ts']
        }
      ]
    };

    expect(() => ReviewReportSchema.parse(report)).toThrow(ZodError);
  });

  it('rejects an invalid nested code-quality result', () => {
    const report = createReviewReport();

    const invalidReport = {
      ...report,
      fileReviews: [
        {
          ...report.fileReviews[0],
          codeQuality: {
            ...report.fileReviews[0].codeQuality,
            overallScore: 101
          }
        }
      ]
    };

    expect(() => ReviewReportSchema.parse(invalidReport)).toThrow(ZodError);
  });

  it('rejects a non-numeric pull request number', () => {
    const report = {
      ...createReviewReport(),
      pullRequest: {
        ...createReviewReport().pullRequest,
        number: '42'
      }
    };

    expect(() => ReviewReportSchema.parse(report)).toThrow(ZodError);
  });
});

describe('exported JSON Schemas', () => {
  it('exports a valid object schema for code-quality results', () => {
    expectObjectJSONSchema(CodeQualityResultJSONSchema, [
      'file',
      'issues',
      'overallScore',
      'summary'
    ]);
  });

  it('exports a valid object schema for test-coverage results', () => {
    expectObjectJSONSchema(TestCoverageResultJSONSchema, [
      'file',
      'hasTests',
      'testFiles',
      'untestedPaths',
      'coverageEstimate',
      'summary'
    ]);
  });

  it('exports a valid object schema for refactoring results', () => {
    expectObjectJSONSchema(RefactoringSuggestionJSONSchema, [
      'file',
      'suggestions',
      'summary'
    ]);
  });

  it('exports a valid object schema for the complete review report', () => {
    expectObjectJSONSchema(ReviewReportJSONSchema, [
      'pullRequest',
      'fileReviews',
      'summary',
      'recommendations',
      'metadata'
    ]);
  });
});
