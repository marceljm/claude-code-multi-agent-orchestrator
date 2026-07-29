import winston from 'winston';

export type LogMetadata = Record<string, unknown>;

export interface StructuredLogger {
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
}

export interface StructuredErrorFields {
  errorName: string;
  errorMessage: string;
  errorCode?: string;
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

const SENSITIVE_ENVIRONMENT_NAMES = [
  'ANTHROPIC_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN'
] as const;

const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  '\\b(ANTHROPIC_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|' +
  'AWS_SESSION_TOKEN|GITHUB_TOKEN)\\s*[:=]\\s*([^\\s,;]+)',
  'gi'
);

const CREDENTIAL_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  replacement: string;
}> = [
  { pattern: /\bsk-ant-[A-Za-z0-9_-]+\b/g, replacement: '[REDACTED]' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9_]+\b/g, replacement: '[REDACTED]' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]+\b/g, replacement: '[REDACTED]' },
  { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replacement: '[REDACTED]' },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, replacement: 'Bearer [REDACTED]' }
];

function redactSensitiveText(value: string): string {
  let redacted = value.replace(SECRET_ASSIGNMENT_PATTERN, '$1=[REDACTED]');

  for (const environmentName of SENSITIVE_ENVIRONMENT_NAMES) {
    const secret = process.env[environmentName];
    if (secret === undefined || secret.length < 8) {
      continue;
    }
    redacted = redacted.split(secret).join('[REDACTED]');
  }

  for (const { pattern, replacement } of CREDENTIAL_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }

  return redacted;
}

export function getStructuredErrorFields(error: unknown): StructuredErrorFields {
  const errorCode = readErrorCode(error);
  if (error instanceof Error) {
    const fields: StructuredErrorFields = {
      errorName: redactSensitiveText(error.name),
      errorMessage: redactSensitiveText(error.message),
      ...(errorCode === undefined ? {} : { errorCode: redactSensitiveText(errorCode) })
    };
    return fields;
  }

  return {
    errorName: 'NonError',
    errorMessage: redactSensitiveText(String(error)),
    ...(errorCode === undefined ? {} : { errorCode: redactSensitiveText(errorCode) })
  };
}

/**
 * Application logger using Winston
 * Outputs to console and log files with structured JSON format
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'code-review-system' },
  transports: [
    // Error logs
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error'
    }),
    // Combined logs
    new winston.transports.File({
      filename: 'logs/combined.log'
    })
  ]
});

// Console output for non-production
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const metaStr = Object.keys(meta).length > 1
          ? `\n${JSON.stringify(meta, null, 2)}`
          : '';
        return `${timestamp} [${level}]: ${message}${metaStr}`;
      })
    )
  }));
}

/**
 * Log helper functions for common operations
 */
export const logReviewStart = (owner: string, repo: string, prNumber: number) => {
  logger.info('Starting code review', { owner, repo, prNumber });
};

export const logReviewComplete = (
  owner: string,
  repo: string,
  prNumber: number,
  score: number,
  duration: number
) => {
  logger.info('Code review completed', {
    owner,
    repo,
    prNumber,
    score,
    duration,
    status: 'success'
  });
};

export const logReviewError = (
  owner: string,
  repo: string,
  prNumber: number,
  error: Error
) => {
  logger.error('Code review failed', {
    owner,
    repo,
    prNumber,
    error: error.message,
    stack: error.stack,
    status: 'failed'
  });
};

export const logAgentStart = (agentName: string, file: string) => {
  logger.debug('Subagent starting', { agent: agentName, file });
};

export const logAgentComplete = (agentName: string, file: string, duration: number) => {
  logger.debug('Subagent completed', { agent: agentName, file, duration });
};
