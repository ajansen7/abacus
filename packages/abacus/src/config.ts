import { z } from 'zod';

const RawEnv = z.object({
  ABACUS_HOST: z.string().default('127.0.0.1'),
  ABACUS_PORT: z.coerce.number().int().positive().default(3001),
  ABACUS_RUNTIME_DIR: z.string().default('runtime'),
  ABACUS_WATCHDOG_WALLCLOCK_SECONDS: z.coerce.number().int().positive().default(600),
  ABACUS_MAX_ITERATIONS: z.coerce.number().int().positive().default(40),
  ABACUS_DEDUPE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(60),
  ABACUS_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  ABACUS_RUNNER: z.enum(['dummy', 'claude']).default('dummy'),
  ABACUS_PACKAGES_DIR: z.string().default('packages'),
  ABACUS_HTTP_LOG: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  ABACUS_CORS_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),
  ABACUS_STATE_SHIM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

export type Config = z.infer<typeof RawEnv>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return RawEnv.parse(env);
}
