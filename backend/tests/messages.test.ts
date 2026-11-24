import { expect, it } from 'vitest';
import { createMessageSchema, editMessageSchema } from '../src/validators/messages.js';

it.each([
  { operation: 'creating', schema: createMessageSchema },
  { operation: 'editing', schema: editMessageSchema },
])('rejects whitespace-only content when $operation a message', ({ schema }) => {
  const result = schema.safeParse({ clientMessageId: 'test-message', content: ' \t\n ' });

  expect(result).toMatchObject({
    success: false,
    error: { issues: [{ path: ['content'], code: 'too_small' }] },
  });
});

it('trims surrounding whitespace without changing the message body', () => {
  const message = createMessageSchema.parse({
    clientMessageId: 'test-message',
    content: ' \tHello,  Relay!\n ',
  });

  expect(message.content).toBe('Hello,  Relay!');
});
