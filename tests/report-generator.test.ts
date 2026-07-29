import {
  describe,
  expect,
  it
} from 'vitest';

import { ReportGenerator } from '../src/utils/report-generator.js';
import type { ReviewReport } from '../src/types/index.js';

const report: ReviewReport = {
  pullRequest: {
    owner: 'example',
    repo: 'project',
    number: 7
  },
  fileReviews: [{
    file: 'src/example.ts',
    codeQuality: {
      file: 'src/example.ts',
      issues: [],
      overallScore: 100,
      summary: 'No quality issues found.'
    },
    testCoverage: {
      file: 'src/example.ts',
      hasTests: true,
      testFiles: ['src/example.test.ts'],
      untestedPaths: [],
      coverageEstimate: 100,
      summary: 'The file is fully tested.'
    },
    refactorings: {
      file: 'src/example.ts',
      suggestions: [],
      summary: 'No refactoring is required.'
    }
  }],
  summary: {
    totalFiles: 1,
    overallScore: 100,
    criticalIssues: 0,
    highPriorityTests: 0,
    refactoringOpportunities: 0
  },
  recommendations: [],
  metadata: {
    analyzedAt: '2026-07-28T00:00:00.000Z',
    duration: 25,
    agentVersions: {
      orchestrator: '1.0.0',
      codeQualityAnalyzer: '1.0.0',
      testCoverageAnalyzer: '1.0.0',
      refactoringSuggester: '1.0.0'
    }
  }
};

describe('ReportGenerator', () => {
  it('lists every reviewed file in HTML', () => {
    const html = new ReportGenerator().generateHTMLReport(report);
    expect(html).toContain('<h2>📁 Reviewed Files</h2>');
    expect(html).toContain('<code>src/example.ts</code>');
  });

  it('does not emit trailing horizontal whitespace', () => {
    const generator = new ReportGenerator();
    const outputs = [
      generator.generateMarkdownReport(report),
      generator.generateHTMLReport(report)
    ];

    for (
      const output
      of outputs
    ) {
      expect(output).not.toMatch(/[ \t]+$/m);
    }
  });
});
