import { test, expect } from '@playwright/test';
import { greet, dbUrl } from '@repro/core/lib/conversations';

test('greet returns expected string', () => {
  expect(greet('world')).toBe('Hello, world');
});

test('dbUrl returns a string', () => {
  expect(typeof dbUrl()).toBe('string');
});
