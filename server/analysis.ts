import { getLensDefinition } from "./lenses.js";
import type {
  AnalyzeResponse,
  Lens,
  ProbabilityPoint,
  SystemOneResponse,
  UsageSnapshot,
  VisualizationChoice,
  VisualizationSignal,
} from "./types.js";

const INPUT_PRICE_USD_PER_MILLION = 0.042;

export class InvalidAnalysisResponseError extends Error {
  readonly code = "UPSTREAM_RESPONSE_INVALID";

  constructor() {
    super("TypeSafe returned answers that do not match the questions.");
    this.name = "InvalidAnalysisResponseError";
  }
}

export function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function calculateCostUsd(inputTokens: number): number {
  if (!Number.isFinite(inputTokens) || inputTokens <= 0) return 0;
  return (Math.floor(inputTokens) / 1_000_000) * INPUT_PRICE_USD_PER_MILLION;
}

export function countCharacters(value: string): number {
  return Array.from(value).length;
}

export function normalizeScore(score: number, levelCount: number): number {
  if (!Number.isFinite(score) || levelCount <= 1) return 0;
  return clampProbability(score / (levelCount - 1));
}

export function humanizeIdentifier(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) =>
    character.toUpperCase(),
  );
}

function probabilityPoints(
  probabilities: Record<string, number>,
  labels: Record<string, string> = {},
): ProbabilityPoint[] {
  return Object.entries(probabilities)
    .map(([id, probability]) => ({
      id,
      label: labels[id] ?? humanizeIdentifier(id),
      probability: clampProbability(probability),
    }))
    .sort((left, right) => right.probability - left.probability);
}

function hasValidDistribution(
  probabilities: Record<string, number>,
  expectedIds: string[],
): boolean {
  const actualIds = Object.keys(probabilities);
  if (
    actualIds.length !== expectedIds.length ||
    expectedIds.some((id) => !(id in probabilities))
  ) {
    return false;
  }
  const sum = expectedIds.reduce((total, id) => total + probabilities[id], 0);
  return Math.abs(sum - 1) <= 0.02;
}

export interface VisualizationContext {
  lens: Lens;
  requestId: string;
  durationMs: number;
  analyzedAt?: string;
  usageSnapshot: UsageSnapshot;
}

export function toVisualizationResponse(
  response: SystemOneResponse,
  context: VisualizationContext,
): AnalyzeResponse {
  const definition = getLensDefinition(context.lens);
  const signals: VisualizationSignal[] = [];
  const choices: VisualizationChoice[] = [];

  for (const [id, questionDefinition] of Object.entries(
    definition.questions,
  )) {
    const answer = response.answers[id];
    if (!answer || answer.type !== questionDefinition.question.type) {
      throw new InvalidAnalysisResponseError();
    }

    if (answer.type === "choice") {
      const question = questionDefinition.question;
      if (question.type !== "choice") throw new InvalidAnalysisResponseError();
      const expectedOptions = Object.keys(question.criteria);
      if (
        answer.confidence < 0 ||
        answer.confidence > 1 ||
        !expectedOptions.includes(answer.choice) ||
        !hasValidDistribution(answer.probabilities, expectedOptions)
      ) {
        throw new InvalidAnalysisResponseError();
      }
      const optionLabels = questionDefinition.optionLabels ?? {};
      choices.push({
        id,
        label: questionDefinition.label,
        selected: answer.choice,
        selectedLabel:
          optionLabels[answer.choice] ?? humanizeIdentifier(answer.choice),
        confidence: clampProbability(answer.confidence),
        options: probabilityPoints(answer.probabilities, optionLabels),
      });
      continue;
    }

    if (answer.type === "noul") {
      if (answer.noul < 0 || answer.noul > 1) {
        throw new InvalidAnalysisResponseError();
      }
      const probability = clampProbability(answer.noul);
      signals.push({
        id,
        label: questionDefinition.label,
        type: "noul",
        value: probability,
        rawValue: probability,
        certainty: Number(
          clampProbability(Math.abs(probability - 0.5) * 2).toFixed(6),
        ),
        certaintySource: "derived_probability_distance",
        lowLabel: questionDefinition.lowLabel ?? "否",
        highLabel: questionDefinition.highLabel ?? "是",
      });
      continue;
    }

    if (answer.type === "score") {
      const question = questionDefinition.question;
      if (question.type !== "score") {
        throw new InvalidAnalysisResponseError();
      }
      const expectedLevels = question.criteria.map((_, index) => String(index));
      if (
        answer.confidence < 0 ||
        answer.confidence > 1 ||
        answer.score > question.criteria.length - 1 ||
        !hasValidDistribution(answer.probabilities, expectedLevels)
      ) {
        throw new InvalidAnalysisResponseError();
      }
      const labels = Object.fromEntries(
        question.criteria.map((label, index) => [String(index), label]),
      );
      signals.push({
        id,
        label: questionDefinition.label,
        type: "score",
        value: normalizeScore(answer.score, question.criteria.length),
        rawValue: answer.score,
        certainty: clampProbability(answer.confidence),
        certaintySource: "model_confidence",
        lowLabel: questionDefinition.lowLabel ?? question.criteria[0] ?? "低",
        highLabel:
          questionDefinition.highLabel ?? question.criteria.at(-1) ?? "高",
        probabilities: probabilityPoints(answer.probabilities, labels),
      });
    }
  }

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  return {
    signals,
    choices,
    meta: {
      lens: context.lens,
      model: response.model,
      usage: { inputTokens, outputTokens },
      estimatedCostUsd: calculateCostUsd(inputTokens),
      requestId: context.requestId,
      durationMs: Math.max(0, Math.round(context.durationMs)),
      analyzedAt: context.analyzedAt ?? new Date().toISOString(),
      ...context.usageSnapshot,
    },
  };
}

export const PRICING = {
  inputUsdPerMillionTokens: INPUT_PRICE_USD_PER_MILLION,
  outputUsdPerMillionTokens: 0,
} as const;
