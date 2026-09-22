import { existsSync } from "node:fs";
import { resolve } from "node:path";

import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import { z } from "zod";

import {
  countCharacters,
  InvalidAnalysisResponseError,
  PRICING,
} from "./analysis.js";
import { QueueFullError } from "./coordinator.js";
import { AnalysisService } from "./service.js";
import type { Lens } from "./types.js";
import {
  sanitizeDiagnostic,
  TypeSafeClient,
  UpstreamHttpError,
  UpstreamNetworkError,
  UpstreamResponseError,
  UpstreamTimeoutError,
} from "./typesafe.js";
import {
  BudgetExceededError,
  defaultUsageLedgerPath,
  parsePositiveNumber,
  resolveBudgetUsd,
  UsageLedger,
} from "./usage.js";

export const MAX_TEXT_CHARACTERS = 6_000;
export const DEFAULT_MODEL = "jev-latest";

const analyzeBodySchema = z
  .object({
    text: z.string(),
    lens: z.enum(["message", "pitch", "story"]),
  })
  .strict()
  .superRefine((body, context) => {
    if (body.text.trim().length === 0) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Text cannot be empty.",
      });
    }
    if (countCharacters(body.text) > MAX_TEXT_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: `Text cannot exceed ${MAX_TEXT_CHARACTERS} characters.`,
      });
    }
  });

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    retryable?: boolean;
    retryAfterMs?: number;
  };
}

export interface CreateAppOptions {
  apiKey?: string;
  model?: string;
  budgetUsd?: number;
  ledgerPath?: string;
  distPath?: string;
  service?: AnalysisService;
  ledger?: UsageLedger;
  logger?: Pick<Console, "error">;
}

function errorBody(
  code: string,
  message: string,
  requestId?: string,
  extra: Partial<ErrorBody["error"]> = {},
): ErrorBody {
  return { error: { code, message, requestId, ...extra } };
}

const jsonOnly: RequestHandler = (request, response, next) => {
  if (!request.is("application/json")) {
    response
      .status(415)
      .json(errorBody("UNSUPPORTED_MEDIA_TYPE", "Use application/json."));
    return;
  }
  next();
};

export function resolveModel(
  value = process.env.TYPESAFE_MODEL,
): string {
  const model = value?.trim();
  return model || DEFAULT_MODEL;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY?.trim() ?? "";
  const configured = apiKey.length > 0 || options.service !== undefined;
  const model = resolveModel(options.model);
  const budgetUsd = options.budgetUsd ?? resolveBudgetUsd();
  const ledger =
    options.ledger ??
    new UsageLedger(
      options.ledgerPath ?? defaultUsageLedgerPath(),
      budgetUsd,
    );
  const service =
    options.service ??
    new AnalysisService({
      client: new TypeSafeClient({
        apiKey,
        maxRetries: 0,
        totalTimeoutMs: parsePositiveNumber(
          process.env.TYPESAFE_TOTAL_TIMEOUT_MS,
          20_000,
        ),
        attemptTimeoutMs: parsePositiveNumber(
          process.env.TYPESAFE_ATTEMPT_TIMEOUT_MS,
          7_000,
        ),
      }),
      ledger,
      model,
      concurrency: 2,
      maxQueue: 8,
      dedupeTtlMs: 15_000,
    });
  const logger = options.logger ?? console;
  const distPath = options.distPath ?? resolve(process.cwd(), "dist");
  const app = express();

  app.disable("x-powered-by");
  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "32kb", type: "application/json" }));

  app.get("/api/status", async (_request, response, next) => {
    try {
      const usage = await ledger.snapshot();
      response.json({
        ok: true,
        configured,
        model: service.model,
        lenses: ["message", "pitch", "story"] satisfies Lens[],
        limits: {
          maxTextCharacters: MAX_TEXT_CHARACTERS,
          concurrency: service.semaphore.limit,
          maxQueue: service.semaphore.maxQueue,
        },
        pricing: PRICING,
        usage,
        inFlight: {
          active: service.semaphore.activeCount,
          queued: service.semaphore.queuedCount,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/analyze", jsonOnly, async (request, response, next) => {
    const parsed = analyzeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(
        errorBody(
          "INVALID_REQUEST",
          parsed.error.issues[0]?.message ?? "Invalid request body.",
        ),
      );
      return;
    }
    if (!configured) {
      response
        .status(503)
        .json(
          errorBody(
            "NOT_CONFIGURED",
            "The analysis service is not configured.",
          ),
        );
      return;
    }

    try {
      const result = await service.analyze(parsed.data.text, parsed.data.lens);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", (_request, response) => {
    response.status(404).json(errorBody("NOT_FOUND", "API route not found."));
  });

  app.use(express.static(distPath, { index: false }));
  app.use((request, response, next) => {
    if (request.method !== "GET") {
      next();
      return;
    }
    const indexPath = resolve(distPath, "index.html");
    if (!existsSync(indexPath)) {
      next();
      return;
    }
    response.sendFile(indexPath);
  });

  app.use((_request, response) => {
    response.status(404).type("text/plain").send("Not found");
  });

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    const requestId =
      typeof error === "object" &&
      error !== null &&
      "requestId" in error &&
      typeof (error as { requestId?: unknown }).requestId === "string"
        ? (error as { requestId: string }).requestId
        : undefined;

    logger.error(
      `[api] ${sanitizeDiagnostic(error, apiKey ? [apiKey] : [])}`,
    );

    if (error instanceof BudgetExceededError) {
      response
        .status(402)
        .json(
          errorBody(
            error.code,
            "The local analysis budget has been reached.",
            requestId,
          ),
        );
      return;
    }
    if (error instanceof QueueFullError) {
      response
        .status(503)
        .json(
          errorBody(
            error.code,
            "The analysis queue is full. Please try again shortly.",
            requestId,
            { retryable: true, retryAfterMs: 1_000 },
          ),
        );
      return;
    }
    if (error instanceof UpstreamTimeoutError) {
      response
        .status(504)
        .json(
          errorBody(
            error.code,
            "The analysis service timed out. Please try again.",
            requestId,
            { retryable: true },
          ),
        );
      return;
    }
    if (error instanceof UpstreamNetworkError) {
      response
        .status(502)
        .json(
          errorBody(
            error.code,
            "The analysis service could not be reached. Please try again.",
            requestId,
            { retryable: true },
          ),
        );
      return;
    }
    if (error instanceof UpstreamHttpError) {
      const isRateLimited = error.status === 429 || error.status === 529;
      response
        .status(isRateLimited ? 503 : 502)
        .json(
          errorBody(
            isRateLimited ? "UPSTREAM_BUSY" : error.code,
            isRateLimited
              ? "The analysis service is busy. Please try again shortly."
              : "The analysis service rejected the request.",
            requestId,
            {
              retryable: error.retryable,
              retryAfterMs: error.retryAfterMs,
            },
          ),
        );
      return;
    }
    if (
      error instanceof UpstreamResponseError ||
      error instanceof InvalidAnalysisResponseError
    ) {
      response
        .status(502)
        .json(
          errorBody(
            error.code,
            "The analysis service returned an invalid response.",
            requestId,
          ),
        );
      return;
    }

    const syntaxError =
      error instanceof SyntaxError &&
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status?: unknown }).status === 400;
    if (syntaxError) {
      response
        .status(400)
        .json(errorBody("INVALID_JSON", "Request body is not valid JSON."));
      return;
    }

    const payloadTooLarge =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status?: unknown }).status === 413;
    if (payloadTooLarge) {
      response
        .status(413)
        .json(
          errorBody(
            "INPUT_TOO_LARGE",
            `Text cannot exceed ${MAX_TEXT_CHARACTERS} characters.`,
          ),
        );
      return;
    }

    response
      .status(500)
      .json(
        errorBody(
          "INTERNAL_ERROR",
          "The request could not be completed.",
          requestId,
        ),
      );
  };
  app.use(errorHandler);

  return app;
}
