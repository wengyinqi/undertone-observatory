import { z } from "zod";

import type { SystemOneRequest, SystemOneResponse } from "./types.js";

export const TYPESAFE_SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone";

const probabilitySchema = z.number().finite().min(0).max(1);

const noulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: probabilitySchema,
});

const choiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: probabilitySchema,
  probabilities: z.record(z.string(), probabilitySchema),
});

const scoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number().finite().nonnegative(),
  confidence: probabilitySchema,
  legend: z.record(z.string(), z.unknown()),
  probabilities: z.record(z.string(), probabilitySchema),
});

const systemOneResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(
    z.string(),
    z.discriminatedUnion("type", [
      noulAnswerSchema,
      choiceAnswerSchema,
      scoreAnswerSchema,
    ]),
  ),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

export class UpstreamHttpError extends Error {
  readonly code = "UPSTREAM_HTTP_ERROR";

  constructor(
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(`TypeSafe request failed with status ${status}.`);
    this.name = "UpstreamHttpError";
  }
}

export class UpstreamTimeoutError extends Error {
  readonly code = "UPSTREAM_TIMEOUT";

  constructor() {
    super("TypeSafe request exceeded its deadline.");
    this.name = "UpstreamTimeoutError";
  }
}

export class UpstreamResponseError extends Error {
  readonly code = "UPSTREAM_RESPONSE_INVALID";

  constructor() {
    super("TypeSafe returned an invalid response.");
    this.name = "UpstreamResponseError";
  }
}

export class UpstreamNetworkError extends Error {
  readonly code = "UPSTREAM_NETWORK_ERROR";
  readonly retryable = true;

  constructor() {
    super("TypeSafe could not be reached.");
    this.name = "UpstreamNetworkError";
  }
}

export function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  );
}

export function parseRetryAfterMs(
  value: string | null,
  nowMs = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.max(0, dateMs - nowMs);
}

export function retryDelayMs(
  retryIndex: number,
  retryAfterMs: number | undefined,
  baseDelayMs = 300,
  randomValue = 0.5,
): number {
  if (retryAfterMs !== undefined) return Math.max(0, retryAfterMs);
  const exponential = baseDelayMs * 2 ** Math.max(0, retryIndex);
  const jitterMultiplier = 0.75 + Math.min(1, Math.max(0, randomValue)) * 0.5;
  return Math.round(exponential * jitterMultiplier);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeDiagnostic(
  value: unknown,
  secrets: string[] = [],
): string {
  let message = value instanceof Error ? value.message : String(value);
  message = message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/apikey_[A-Za-z0-9_-]+/gi, "[REDACTED_API_KEY]");
  for (const secret of secrets) {
    if (!secret) continue;
    message = message.replace(new RegExp(escapeRegExp(secret), "g"), "[REDACTED]");
  }
  return message.slice(0, 500);
}

export interface TypeSafeClientOptions {
  apiKey: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  totalTimeoutMs?: number;
  attemptTimeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  now?: () => number;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export class TypeSafeClient {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly totalTimeoutMs: number;
  private readonly attemptTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: TypeSafeClientOptions) {
    this.endpoint = options.endpoint ?? TYPESAFE_SYSTEMONE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.totalTimeoutMs = options.totalTimeoutMs ?? 20_000;
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? 7_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.baseDelayMs = options.baseDelayMs ?? 300;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? defaultSleep;
  }

  get maxAttempts(): number {
    return this.maxRetries + 1;
  }

  async analyze(request: SystemOneRequest): Promise<SystemOneResponse> {
    const deadline = this.now() + this.totalTimeoutMs;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const remainingMs = deadline - this.now();
      if (remainingMs <= 0) throw new UpstreamTimeoutError();

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        Math.max(1, Math.min(this.attemptTimeoutMs, remainingMs)),
      );

      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        if (response.ok) {
          let payload: unknown;
          try {
            payload = await response.json();
          } catch (error) {
            if (error instanceof SyntaxError) {
              throw new UpstreamResponseError();
            }
            throw error;
          }
          const parsed = systemOneResponseSchema.safeParse(payload);
          if (!parsed.success) throw new UpstreamResponseError();
          return parsed.data as SystemOneResponse;
        }

        try {
          await response.body?.cancel();
        } catch {
          // Status handling is authoritative; cancellation is best-effort cleanup.
        }
        const retryable = isRetryableStatus(response.status);
        const retryAfter = parseRetryAfterMs(
          response.headers.get("retry-after"),
          this.now(),
        );
        if (!retryable || attempt >= this.maxRetries) {
          throw new UpstreamHttpError(
            response.status,
            retryable,
            retryAfter,
          );
        }

        const delay = retryDelayMs(
          attempt,
          retryAfter,
          this.baseDelayMs,
          this.random(),
        );
        if (delay >= deadline - this.now()) throw new UpstreamTimeoutError();
        await this.sleep(delay);
      } catch (error) {
        if (
          error instanceof UpstreamHttpError ||
          error instanceof UpstreamResponseError ||
          error instanceof UpstreamTimeoutError
        ) {
          throw error;
        }

        if (!isAbortError(error) && !(error instanceof TypeError)) {
          throw error;
        }

        if (attempt >= this.maxRetries) {
          if (isAbortError(error) || this.now() >= deadline) {
            throw new UpstreamTimeoutError();
          }
          throw new UpstreamNetworkError();
        }

        const delay = retryDelayMs(
          attempt,
          undefined,
          this.baseDelayMs,
          this.random(),
        );
        if (delay >= deadline - this.now()) throw new UpstreamTimeoutError();
        await this.sleep(delay);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new UpstreamTimeoutError();
  }
}
