import { dbUrl } from '@repro/core/lib/conversations';

export default async function globalSetup() {
  // exercises the full import chain: global-setup → @repro/core/lib/conversations → @repro/env
  console.log('db url:', dbUrl());
}
