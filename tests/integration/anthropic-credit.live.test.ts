import 'dotenv/config';

import {
  describe,
  expect,
  it
} from 'vitest';

const LIVE =
  process.env
    .RUN_LIVE_ANTHROPIC_CREDIT_CHECK ===
  '1';

const DIRECT_ANTHROPIC_BASE_URL =
  'https://api.anthropic.com';

const VOCAREUM_BASE_URL =
  'https://claude.vocareum.com';

function normalizeBaseUrl(
  value: string
): string {
  return value.replace(/\/+$/, '');
}

function resolveMessagesUrl(
  configuredBaseUrl: string | undefined
): string {
  const trimmedBaseUrl =
    configuredBaseUrl?.trim();

  if (!trimmedBaseUrl) {
    return `${DIRECT_ANTHROPIC_BASE_URL}/v1/messages`;
  }

  const normalizedBaseUrl =
    normalizeBaseUrl(trimmedBaseUrl);

  if (
    normalizedBaseUrl ===
      VOCAREUM_BASE_URL
  ) {
    return `${normalizedBaseUrl}/v1/messages`;
  }

  throw new Error(
    `ANTHROPIC_BASE_URL must be unset for direct Anthropic API access or set to ${VOCAREUM_BASE_URL} for Udacity Vocareum.`
  );
}

interface AnthropicSuccessBody {
  id?: unknown;
  type?: unknown;
  stop_reason?: unknown;

  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
  };
}

interface AnthropicErrorBody {
  type?: unknown;

  error?: {
    type?: unknown;
    message?: unknown;
  };
}

function requireEnvironmentVariable(
  variableName: string
): string {
  const value =
    process.env[
      variableName
    ]?.trim();

  if (!value) {
    throw new Error(
      `${variableName} is required for the Anthropic credit smoke test.`
    );
  }

  return value;
}

function redact(
  value: string,
  sensitiveValues: string[]
): string {
  return sensitiveValues.reduce(
    (
      sanitized,
      sensitiveValue
    ) =>
      sensitiveValue.length === 0
        ? sanitized
        : sanitized
            .split(
              sensitiveValue
            )
            .join(
              '<redacted>'
            ),
    value
  );
}

function parseJson(
  value: string
): unknown {
  try {
    return JSON.parse(
      value
    ) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function readProviderError(
  body: unknown
): {
  type: string;
  message: string;
} {
  if (!isRecord(body)) {
    return {
      type:
        'unknown_error',
      message:
        'The provider returned a non-JSON error response.'
    };
  }

  const error =
    isRecord(body.error)
      ? body.error
      : {};

  return {
    type:
      typeof error.type ===
        'string'
        ? error.type
        : 'unknown_error',

    message:
      typeof error.message ===
        'string'
        ? error.message
        : 'The provider did not return an error message.'
  };
}

function classifyFailure(
  status: number,
  errorType: string,
  message: string
): string {
  const normalized =
    `${errorType} ${message}`
      .toLowerCase();

  if (status === 401) {
    return 'authentication';
  }

  if (
    status === 402 ||
    /credit|billing|balance|budget|spend limit|payment required|insufficient funds/.test(
      normalized
    )
  ) {
    return 'billing-or-credit';
  }

  if (status === 403) {
    return 'permission';
  }

  if (
    status === 429 ||
    /quota|rate limit/.test(
      normalized
    )
  ) {
    return 'rate-limit-or-quota';
  }

  if (status === 404) {
    return 'model-or-endpoint';
  }

  if (status >= 500) {
    return 'provider-or-gateway';
  }

  return 'request-rejected';
}

describe(
  'Anthropic failure classification',
  () => {
    it(
      'classifies insufficient budget as billing or credit',
      () => {
        expect(
          classifyFailure(
            400,
            'invalid_request_error',
            'Insufficient budget available.'
          )
        ).toBe(
          'billing-or-credit'
        );
      }
    );
  }
);

describe(
  'Anthropic Messages endpoint resolution',
  () => {
    it(
      'uses the direct Anthropic endpoint when the base URL is unset',
      () => {
        expect(
          resolveMessagesUrl(undefined)
        ).toBe(
          'https://api.anthropic.com/v1/messages'
        );
      }
    );

    it(
      'uses the direct Anthropic endpoint when the base URL is empty',
      () => {
        expect(
          resolveMessagesUrl('   ')
        ).toBe(
          'https://api.anthropic.com/v1/messages'
        );
      }
    );

    it(
      'uses the Udacity Vocareum endpoint',
      () => {
        expect(
          resolveMessagesUrl('https://claude.vocareum.com')
        ).toBe(
          'https://claude.vocareum.com/v1/messages'
        );
      }
    );

    it(
      'normalizes a trailing slash in the Vocareum endpoint',
      () => {
        expect(
          resolveMessagesUrl('https://claude.vocareum.com/')
        ).toBe(
          'https://claude.vocareum.com/v1/messages'
        );
      }
    );

    it(
      'rejects unsupported custom endpoints',
      () => {
        expect(
          () => resolveMessagesUrl('https://unsupported.example.test')
        ).toThrow(
          'ANTHROPIC_BASE_URL must be unset for direct Anthropic API access or set to https://claude.vocareum.com for Udacity Vocareum.'
        );
      }
    );
  }
);

describe.skipIf(
  !LIVE
)(
  'Configured Anthropic provider availability smoke test',
  () => {
    it(
      'completes one minimal Messages API request against the configured provider',
      async () => {
        const apiKey =
          requireEnvironmentVariable(
            'ANTHROPIC_API_KEY'
          );

        const model =
          requireEnvironmentVariable(
            'ANTHROPIC_MODEL'
          );

        const messagesUrl =
          resolveMessagesUrl(
            process.env.ANTHROPIC_BASE_URL
          );

        const sensitiveValues = [
          apiKey
        ];

        const controller =
          new AbortController();

        const timeout =
          setTimeout(
            () =>
              controller.abort(),
            30_000
          );

        let response:
          Response;

        try {
          response =
            await fetch(
              messagesUrl,
              {
                method:
                  'POST',

                headers: {
                  'content-type':
                    'application/json',

                  'x-api-key':
                    apiKey,

                  'anthropic-version':
                    '2023-06-01'
                },

                body:
                  JSON.stringify({
                    model,

                    max_tokens:
                      1,

                    temperature:
                      0,

                    messages: [
                      {
                        role:
                          'user',

                        content:
                          'Reply with OK.'
                      }
                    ]
                  }),

                signal:
                  controller.signal
              }
            );
        } catch (
          error
        ) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          throw new Error(
            `Anthropic availability check could not reach the configured provider: ${
              redact(
                message,
                sensitiveValues
              )
            }`
          );
        } finally {
          clearTimeout(
            timeout
          );
        }

        const rawBody =
          await response.text();

        const parsedBody =
          parseJson(
            rawBody
          );

        if (!response.ok) {
          const providerError =
            readProviderError(
              parsedBody
            );

          const classification =
            classifyFailure(
              response.status,
              providerError.type,
              providerError.message
            );

          throw new Error(
            [
              'Anthropic availability check failed.',
              `HTTP status: ${response.status}.`,
              `Classification: ${classification}.`,
              `Provider error type: ${providerError.type}.`,
              `Provider message: ${
                redact(
                  providerError.message,
                  sensitiveValues
                )
              }`
            ].join(
              ' '
            )
          );
        }

        const success =
          parsedBody as
            AnthropicSuccessBody;

        expect(
          success.type
        ).toBe(
          'message'
        );

        expect(
          typeof success.id
        ).toBe(
          'string'
        );

        const inputTokens =
          success.usage
            ?.input_tokens;

        const outputTokens =
          success.usage
            ?.output_tokens;

        console.log(
          [
            'Anthropic availability check passed.',
            `HTTP status: ${response.status}.`,
            `Input tokens: ${
              typeof inputTokens ===
                'number'
                ? inputTokens
                : 'unreported'
            }.`,
            `Output tokens: ${
              typeof outputTokens ===
                'number'
                ? outputTokens
                : 'unreported'
            }.`,
            `Stop reason: ${
              typeof success.stop_reason ===
                'string'
                ? success.stop_reason
                : 'unreported'
            }.`
          ].join(
            ' '
          )
        );
      },
      45_000
    );
  }
);
