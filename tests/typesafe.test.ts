import { describe, expect, it, vi } from "vitest";

import type { SystemOneRequest, SystemOneResponse } from "../server/types.js";
import {
  isRetryableStatus,
  parseRetryAfterMs,
  retryDelayMs,
  sanitizeDiagnostic,
  TypeSafeClient,
  UpstreamHttpError,
  UpstreamResponseError,
  UpstreamTimeoutError,
} from "../server/typesafe.js";

const request: SystemOneRequest = {
  model: "jev-1.13.0",
  state: "Test input",
  questions: {
    relevant: {
      type: "noul",
      instructions: "Is this relevant?",
      criteria: { true: "Relevant", false: "Not relevant" },
    },
  },
};

const payload: SystemOneResponse = {
  model: "jev-1.13.0",
  answers: { relevant: { type: "noul", noul: 0.8 } },
  usage: { input_tokens: 123, output_tokens: 5 },
};

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("TypeSafe retry helpers", () => {
  it("retries only timeout, rate-limit, overload, and standard 5xx statuses", () => {
    for (const status of [408, 429, 500, 502, 529, 599]) {
      expect(isRetryableStatus(status), String(status)).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 422, 499, 600]) {
      expect(isRetryableStatus(status), String(status)).toBe(false);
    }
  });

  it("parses Retry-After seconds and HTTP dates", () => {
    const now = Date.parse("2026-09-22T00:00:00.000Z");
    expect(parseRetryAfterMs("1.25", now)).toBe(1_250);
    expect(parseRetryAfterMs("Tue, 22 Sep 2026 00:00:02 GMT", now)).toBe(2_000);
    expect(parseRetryAfterMs("not-a-delay", now)).toBeUndefined();
    expect(parseRetryAfterMs(null, now)).toBeUndefined();
  });

  it("applies bounded jitter unless the server supplied a delay", () => {
    expect(retryDelayMs(2, undefined, 300, 0)).toBe(900);
    expect(retryDelayMs(2, undefined, 300, 1)).toBe(1_500);
    expect(retryDelayMs(20, 123, 300, 1)).toBe(123);
  });

  it("redacts credentials and bounds diagnostic length", () => {
    const explicitSecret = "custom-secret-value";
    const message = sanitizeDiagnostic(
      new Error(
        `Bearer token.value apikey_example_123 ${explicitSecret} ${"x".repeat(700)}`,
      ),
      [explicitSecret],
    );

    expect(message).not.toContain("token.value");
    expect(message).not.toContain("apikey_example_123");
    expect(message).not.toContain(explicitSecret);
    expect(message.length).toBeLessThanOrEqual(500);
  });
});

describe("TypeSafeClient", () => {
  it("sends the expected authenticated request and parses a valid response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload));
    const client = new TypeSafeClient({
      apiKey: "test-secret",
      endpoint: "https://unit.test/systemone",
      fetchImpl,
      maxRetries: 0,
    });

    await expect(client.analyze(request)).resolves.toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://unit.test/systemone");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-secret");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it("honors Retry-After on overload and then returns success", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "busy" }, 529, { "retry-after": "0.25" }))
      .mockResolvedValueOnce(jsonResponse(payload));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const client = new TypeSafeClient({
      apiKey: "test-secret",
      fetchImpl,
      maxRetries: 1,
      now: () => 1_000,
      sleep,
    });

    await expect(client.analyze(request)).resolves.toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("retries a connection failure with backoff", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("connection closed"))
      .mockResolvedValueOnce(jsonResponse(payload));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const client = new TypeSafeClient({
      apiKey: "test-secret",
      fetchImpl,
      maxRetries: 1,
      baseDelayMs: 400,
      random: () => 0.5,
      sleep,
    });

    await expect(client.analyze(request)).resolves.toEqual(payload);
    expect(sleep).toHaveBeenCalledWith(400);
  });

  it("does not retry a non-retryable HTTP status", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "invalid" }, 422));
    const client = new TypeSafeClient({
      apiKey: "test-secret",
      fetchImpl,
      maxRetries: 2,
    });

    const outcome = client.analyze(request);
    await expect(outcome).rejects.toBeInstanceOf(UpstreamHttpError);
    await expect(outcome).rejects.toMatchObject({ status: 422, retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a retryable HTTP error after exhausting attempts", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "busy" }, 500));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const client = new TypeSafeClient({
      apiKey: "test-secret",
      fetchImpl,
      maxRetries: 1,
      sleep,
    });

    await expect(client.analyze(request)).rejects.toMatchObject({
      status: 500,
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invalid JSON", new Response("not-json", { status: 200 })],
    ["invalid schema", jsonResponse({ ...payload, usage: { input_tokens: -1 } })],
  ])("rejects %s without retrying", async (_label, response) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const client = new TypeSafeClient({
      apiKey: "test-secret",
      fetchImpl,
      maxRetries: 2,
    });

    await expect(client.analyze(request)).rejects.toBeInstanceOf(
      UpstreamResponseError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps an exhausted abort to a timeout error", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("aborted", "AbortError"));
    const client = new TypeSafeClient({
      apiKey: "test-secret",
      fetchImpl,
      maxRetries: 0,
    });

    await expect(client.analyze(request)).rejects.toBeInstanceOf(
      UpstreamTimeoutError,
    );
  });
});
