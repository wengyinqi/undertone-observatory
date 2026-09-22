import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  calculateCostUsd,
  InvalidAnalysisResponseError,
} from "../server/analysis.js";
import { QueueFullError } from "../server/coordinator.js";
import { buildSystemOneRequest, getLensDefinition } from "../server/lenses.js";
import { AnalysisService } from "../server/service.js";
import type {
  Lens,
  SystemOneAnswer,
  SystemOneResponse,
} from "../server/types.js";
import { TypeSafeClient, UpstreamHttpError } from "../server/typesafe.js";
import {
  estimateReservationTokens,
  UsageLedger,
} from "../server/usage.js";

const MODEL = "jev-1.13.0";

function validAnswer(lens: Lens, id: string): SystemOneAnswer {
  const question = getLensDefinition(lens).questions[id].question;
  if (question.type === "noul") return { type: "noul", noul: 0.75 };

  if (question.type === "choice") {
    const options = Object.keys(question.criteria);
    return {
      type: "choice",
      choice: options[0],
      confidence: 1,
      probabilities: Object.fromEntries(
        options.map((option, index) => [option, index === 0 ? 1 : 0]),
      ),
    };
  }

  return {
    type: "score",
    score: 0,
    confidence: 1,
    legend: Object.fromEntries(
      question.criteria.map((label, index) => [String(index), label]),
    ),
    probabilities: Object.fromEntries(
      question.criteria.map((_, index) => [String(index), index === 0 ? 1 : 0]),
    ),
  };
}

function validResponse(
  lens: Lens = "message",
  inputTokens = 321,
): SystemOneResponse {
  return {
    model: MODEL,
    answers: Object.fromEntries(
      Object.keys(getLensDefinition(lens).questions).map((id) => [
        id,
        validAnswer(lens, id),
      ]),
    ),
    usage: { input_tokens: inputTokens, output_tokens: 17 },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AnalysisService", () => {
  let temporaryDirectory: string;
  let ledgerPath: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "jev-service-test-"));
    ledgerPath = join(temporaryDirectory, "usage.json");
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it.each([
    { status: 408, settlement: "pessimistic" },
    { status: 429, settlement: "release" },
    { status: 500, settlement: "pessimistic" },
  ] as const)(
    "$status failures use $settlement reservation settlement",
    async ({ status, settlement }) => {
      const text = `Status ${status}`;
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ error: "upstream failure" }, status));
      const client = new TypeSafeClient({
        apiKey: "test-secret",
        fetchImpl,
        maxRetries: 0,
      });
      const ledger = new UsageLedger(ledgerPath, 0.25);
      const service = new AnalysisService({
        client,
        ledger,
        model: MODEL,
        requestId: () => `request-${status}`,
      });

      const outcome = service.analyze(text, "message");
      await expect(outcome).rejects.toBeInstanceOf(UpstreamHttpError);
      await expect(outcome).rejects.toMatchObject({ status });

      const snapshot = await ledger.snapshot();
      const reservedTokens =
        estimateReservationTokens(
          buildSystemOneRequest(text, "message", MODEL),
        ) * client.maxAttempts;

      if (settlement === "pessimistic") {
        expect(snapshot).toMatchObject({
          spentUsd: calculateCostUsd(reservedTokens),
          reservedUsd: 0,
          inputTokens: reservedTokens,
          outputTokens: 0,
          requests: 1,
        });
      } else {
        expect(snapshot).toMatchObject({
          spentUsd: 0,
          reservedUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          requests: 0,
        });
      }
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects work beyond the configured queue with QUEUE_FULL", async () => {
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => firstResponse)
      .mockImplementation(async () => jsonResponse(validResponse()));
    const client = new TypeSafeClient({
      apiKey: "test-secret",
      fetchImpl,
      maxRetries: 0,
    });
    const ledger = new UsageLedger(ledgerPath, 0.25);
    let requestNumber = 0;
    const service = new AnalysisService({
      client,
      ledger,
      model: MODEL,
      concurrency: 1,
      maxQueue: 1,
      requestId: () => `request-${++requestNumber}`,
    });

    const first = service.analyze("First", "message");
    const second = service.analyze("Second", "message");
    const overflow = service.analyze("Third", "message");

    await expect(overflow).rejects.toBeInstanceOf(QueueFullError);
    await expect(overflow).rejects.toMatchObject({ code: "QUEUE_FULL" });
    expect(service.semaphore.activeCount).toBe(1);
    expect(service.semaphore.queuedCount).toBe(1);

    resolveFirst(jsonResponse(validResponse()));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await expect(ledger.snapshot()).resolves.toMatchObject({
      requests: 2,
      reservedUsd: 0,
    });
  });

  it("accounts actual usage before rejecting an invalid probability distribution", async () => {
    const payload = validResponse("message", 777);
    const tone = payload.answers.tone;
    if (tone.type !== "choice") throw new Error("Test fixture is invalid.");
    tone.probabilities = {
      warm: 0.6,
      neutral: 0.6,
      assertive: 0,
      guarded: 0,
      hostile: 0,
    };

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(payload));
    const client = new TypeSafeClient({
      apiKey: "test-secret",
      fetchImpl,
      maxRetries: 0,
    });
    const ledger = new UsageLedger(ledgerPath, 0.25);
    const service = new AnalysisService({
      client,
      ledger,
      model: MODEL,
      requestId: () => "request-invalid-distribution",
    });

    await expect(service.analyze("Analyze me", "message")).rejects.toBeInstanceOf(
      InvalidAnalysisResponseError,
    );
    await expect(ledger.snapshot()).resolves.toMatchObject({
      spentUsd: calculateCostUsd(777),
      reservedUsd: 0,
      inputTokens: 777,
      outputTokens: 17,
      requests: 1,
    });
  });
});
