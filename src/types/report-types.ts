import { z } from 'zod';
import { toDraft07JsonSchema } from './json-schema.js';
import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema
} from './analysis-results.js';

/**
 * Complete Review Report Schema
 * Aggregates all subagent results into a unified report
 */
const AgentVersionsSchema = z.strictObject({
  orchestrator: z.string(),
  codeQualityAnalyzer: z.string(),
  testCoverageAnalyzer: z.string(),
  refactoringSuggester: z.string()
});

export const ReviewReportSchema = z.object({
  pullRequest: z.object({
    owner: z.string(),
    repo: z.string(),
    number: z.number()
  }),
  fileReviews: z.array(z.object({
    file: z.string(),
    codeQuality: CodeQualityResultSchema,
    testCoverage: TestCoverageResultSchema,
    refactorings: RefactoringSuggestionSchema
  })),
  summary: z.object({
    totalFiles: z.number(),
    overallScore: z.number(),
    criticalIssues: z.number(),
    highPriorityTests: z.number(),
    refactoringOpportunities: z.number()
  }),
  recommendations: z.array(z.object({
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    category: z.string(),
    description: z.string(),
    files: z.array(z.string())
  })),
  metadata: z.object({
    analyzedAt: z.string(),
    duration: z.number(),
    agentVersions: AgentVersionsSchema
  })
});

/**
 * TypeScript type inferred from Zod schema
 */
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

export const ReviewReportJSONSchema = toDraft07JsonSchema(ReviewReportSchema);
