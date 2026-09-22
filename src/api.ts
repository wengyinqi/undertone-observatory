import { ApiError, type AnalysisResponse, type Lens, type StatusResponse } from "./types";

const clamp01 = (value: unknown, fallback = 0): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
};

const asText = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

function normalizeAnalysis(payload: AnalysisResponse, requestedLens: Lens): AnalysisResponse {
  const signals = Array.isArray(payload?.signals)
    ? payload.signals.map((signal, index) => ({
        id: asText(signal.id, `signal-${index}`),
        label: asText(signal.label, `信号 ${index + 1}`),
        type: signal.type === "noul" ? "noul" as const : "score" as const,
        value: clamp01(signal.value),
        rawValue: Number.isFinite(Number(signal.rawValue)) ? Number(signal.rawValue) : clamp01(signal.value),
        certainty: clamp01(signal.certainty),
        certaintySource: asText(signal.certaintySource, signal.type === "noul" ? "derived_probability_distance" : "model_confidence"),
        lowLabel: asText(signal.lowLabel, "低"),
        highLabel: asText(signal.highLabel, "高"),
        probabilities: signal.probabilities,
      }))
    : [];

  const choices = Array.isArray(payload?.choices)
    ? payload.choices.map((choice, index) => ({
        id: asText(choice.id, `choice-${index}`),
        label: asText(choice.label, `判断 ${index + 1}`),
        selected: asText(choice.selected),
        selectedLabel: asText(choice.selectedLabel),
        confidence: clamp01(choice.confidence),
        options: Array.isArray(choice.options)
          ? choice.options.map((option, optionIndex) => ({
              id: asText(option.id, `option-${optionIndex}`),
              label: asText(option.label, asText(option.id, `选项 ${optionIndex + 1}`)),
              probability: clamp01(option.probability),
            }))
          : [],
      }))
    : [];

  const meta = payload?.meta ?? ({} as AnalysisResponse["meta"]);
  return {
    signals,
    choices,
    meta: {
      lens: meta.lens ?? requestedLens,
      model: asText(meta.model, "jev-latest"),
      usage: {
        inputTokens: Number(meta.usage?.inputTokens ?? 0),
        outputTokens: Number(meta.usage?.outputTokens ?? 0),
      },
      estimatedCostUsd: Number(meta.estimatedCostUsd ?? 0),
      budgetUsd: Number(meta.budgetUsd ?? 5),
      spentUsd: Number(meta.spentUsd ?? 0),
      remainingUsd: Number(meta.remainingUsd ?? 5),
      requestId: asText(meta.requestId),
      durationMs: Number(meta.durationMs ?? 0),
      analyzedAt: asText(meta.analyzedAt, new Date().toISOString()),
    },
  };
}

async function readJson<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError("观测链路返回了无法识别的数据。", "INVALID_RESPONSE", response.status >= 500);
  }

  if (!response.ok) {
    const body = payload as { error?: { code?: string; message?: string; retryable?: boolean; retryAfterMs?: number } };
    throw new ApiError(
      body.error?.message ?? "本次观测未完成，请稍后重试。",
      body.error?.code ?? `HTTP_${response.status}`,
      body.error?.retryable ?? response.status >= 500,
      body.error?.retryAfterMs,
    );
  }

  return payload as T;
}

export async function getStatus(signal?: AbortSignal): Promise<StatusResponse> {
  const response = await fetch("/api/status", { headers: { Accept: "application/json" }, signal });
  return readJson<StatusResponse>(response);
}

export async function analyzeText(text: string, lens: Lens, signal?: AbortSignal): Promise<AnalysisResponse> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ text, lens }),
    signal,
  });
  return normalizeAnalysis(await readJson<AnalysisResponse>(response), lens);
}
