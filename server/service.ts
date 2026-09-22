import { createHash, randomUUID } from "node:crypto";

import { toVisualizationResponse } from "./analysis.js";
import { AsyncSemaphore, SingleFlightCache } from "./coordinator.js";
import { buildSystemOneRequest } from "./lenses.js";
import type { AnalyzeResponse, Lens } from "./types.js";
import { TypeSafeClient, UpstreamHttpError } from "./typesafe.js";
import { estimateReservationTokens, UsageLedger } from "./usage.js";

export interface AnalysisServiceOptions {
  client: TypeSafeClient;
  ledger: UsageLedger;
  model?: string;
  concurrency?: number;
  maxQueue?: number;
  dedupeTtlMs?: number;
  now?: () => number;
  requestId?: () => string;
}

export function analysisCacheKey(
  text: string,
  lens: Lens,
  model: string,
): string {
  return createHash("sha256")
    .update(model)
    .update("\0")
    .update(lens)
    .update("\0")
    .update(text)
    .digest("hex");
}

export function isDefinitelyUnbilledFailure(error: unknown): boolean {
  if (!(error instanceof UpstreamHttpError)) return false;
  return (
    (error.status >= 400 && error.status <= 499 && error.status !== 408) ||
    error.status === 529
  );
}

export class AnalysisService {
  readonly model: string;
  readonly semaphore: AsyncSemaphore;
  private readonly cache: SingleFlightCache<AnalyzeResponse>;
  private readonly now: () => number;
  private readonly requestId: () => string;

  constructor(private readonly options: AnalysisServiceOptions) {
    this.model = options.model ?? "jev-latest";
    this.semaphore = new AsyncSemaphore(
      options.concurrency ?? 2,
      options.maxQueue ?? 8,
    );
    this.now = options.now ?? Date.now;
    this.requestId = options.requestId ?? randomUUID;
    this.cache = new SingleFlightCache(
      options.dedupeTtlMs ?? 0,
      this.now,
    );
  }

  analyze(text: string, lens: Lens): Promise<AnalyzeResponse> {
    const cacheKey = analysisCacheKey(text, lens, this.model);
    return this.cache.getOrCreate(cacheKey, () =>
      this.semaphore.run(() => this.execute(text, lens)),
    );
  }

  private async execute(text: string, lens: Lens): Promise<AnalyzeResponse> {
    const requestId = this.requestId();
    const startedAt = this.now();
    const request = buildSystemOneRequest(text, lens, this.model);
    const reservationTokens =
      estimateReservationTokens(request) * this.options.client.maxAttempts;
    let usageCommitted = false;

    await this.options.ledger.reserve(requestId, reservationTokens);
    try {
      const upstreamResponse = await this.options.client.analyze(request);
      const usageSnapshot = await this.options.ledger.commit(requestId, {
        inputTokens: upstreamResponse.usage.input_tokens,
        outputTokens: upstreamResponse.usage.output_tokens,
      });
      usageCommitted = true;

      return toVisualizationResponse(upstreamResponse, {
        lens,
        requestId,
        durationMs: this.now() - startedAt,
        analyzedAt: new Date(this.now()).toISOString(),
        usageSnapshot,
      });
    } catch (error) {
      if (!usageCommitted) {
        if (isDefinitelyUnbilledFailure(error)) {
          await this.options.ledger.release(requestId);
        } else {
          // Timeout, disconnect, 5xx, or malformed 200 may have consumed input.
          // Charge the full reservation so the local hard cap remains fail-closed.
          await this.options.ledger.commit(requestId, {
            inputTokens: reservationTokens,
            outputTokens: 0,
          });
        }
      }
      throw error;
    }
  }
}
