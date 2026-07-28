import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  CodeReviewOrchestrator
} from '../src/orchestrator.js';

import type {
  OrchestratorOptions
} from '../src/orchestrator.js';

const MODEL = 'claude-sonnet-4-5-20250929';
const PROJECT_ROOT = '/tmp/code-review-project';

function createAsyncIterable(
  messages: unknown[]
): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) {
        yield message;
      }
    }
  };
}

function createQueryMock(messages: unknown[]) {
  const mock = vi.fn((_input: unknown) =>
    createAsyncIterable(messages)
  );

  return {
    mock,
    queryFn:
      mock as unknown as NonNullable<
        OrchestratorOptions['queryFn']
      >
  };
}

describe('CodeReviewOrchestrator observability', () => {
  it('forwards every streamed SDK message to the observer', async () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: []
        }
      },
      {
        type: 'result',
        subtype: 'error_max_turns'
      }
    ];

    const {
      mock,
      queryFn
    } = createQueryMock(messages);

    const observedMessages: unknown[] = [];

    const orchestrator = new CodeReviewOrchestrator({
      model: MODEL,
      projectRoot: PROJECT_ROOT,
      queryFn,
      onMessage: message => {
        observedMessages.push(message);
      }
    });

    await expect(
      orchestrator.reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        1
      )
    ).rejects.toThrow('error_max_turns');

    expect(mock).toHaveBeenCalledTimes(1);
    expect(observedMessages).toEqual(messages);
  });

  it('awaits an asynchronous observer', async () => {
    const messages = [
      {
        type: 'result',
        subtype: 'error_max_turns'
      }
    ];

    const {
      queryFn
    } = createQueryMock(messages);

    const observedMessages: unknown[] = [];

    const orchestrator = new CodeReviewOrchestrator({
      model: MODEL,
      projectRoot: PROJECT_ROOT,
      queryFn,
      onMessage: async message => {
        await Promise.resolve();
        observedMessages.push(message);
      }
    });

    await expect(
      orchestrator.reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        1
      )
    ).rejects.toThrow('error_max_turns');

    expect(observedMessages).toEqual(messages);
  });

  it('propagates observer failures', async () => {
    const {
      queryFn
    } = createQueryMock([
      {
        type: 'assistant',
        message: {
          content: []
        }
      },
      {
        type: 'result',
        subtype: 'error_max_turns'
      }
    ]);

    const orchestrator = new CodeReviewOrchestrator({
      model: MODEL,
      projectRoot: PROJECT_ROOT,
      queryFn,
      onMessage: () => {
        throw new Error('observer failed');
      }
    });

    await expect(
      orchestrator.reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        1
      )
    ).rejects.toThrow('observer failed');
  });

  it('acknowledges bypassPermissions explicitly', async () => {
    const {
      mock,
      queryFn
    } = createQueryMock([
      {
        type: 'result',
        subtype: 'error_max_turns'
      }
    ]);

    const orchestrator = new CodeReviewOrchestrator({
      model: MODEL,
      projectRoot: PROJECT_ROOT,
      queryFn
    });

    await expect(
      orchestrator.reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        1
      )
    ).rejects.toThrow('error_max_turns');

    const call = mock.mock.calls[0]?.[0] as {
      options: {
        permissionMode: string;
        allowDangerouslySkipPermissions?: boolean;
      };
    };

    expect(call.options.permissionMode).toBe(
      'bypassPermissions'
    );

    expect(
      call.options.allowDangerouslySkipPermissions
    ).toBe(true);
  });
});
