import { vi } from 'vitest';
import { createRequire } from 'node:module';
// Only the testing framework API is adapted; the upstream files and assertions stay intact.
globalThis.jest = vi;
globalThis.__upstreamRequireActual = createRequire(import.meta.url);
