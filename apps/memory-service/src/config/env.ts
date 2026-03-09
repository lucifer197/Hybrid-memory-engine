import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://hybrid:hybrid@localhost:5432/hybrid_memory"),
  PORT: z.coerce.number().int().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = EnvSchema.parse(process.env);
  }
  return _env;
}
