import { test, expect } from '@playwright/test';
import { greet } from '@repro/core/lib/conversations';

test('greet returns expected string', () => {
  expect(greet('world')).toBe('Hello, world');
});
