import { env } from '@repro/env';
export { greet } from '@repro/shared/lib/text.utils';

export function dbUrl(): string {
  return env.DATABASE_URL;
}
