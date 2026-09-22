import { describe, expect, it } from "vitest";

import {
  calculateCostUsd,
  clampProbability,
  countCharacters,
  normalizeScore,
  toVisualizationResponse,
} from "../server/analysis.js";
import { getLensDefinition } from "../server/lenses.js";
import type {
  Lens,
  SystemOneAnswer,
  SystemOneResponse,
  UsageSnapshot,
} from "../server/types.js";

const usageSnapshot: UsageSnapshot = {
  budgetUsd: 0.25,
  spentUsd: 0.01,
  reservedUsd: 0.002,
  remainingUsd: 0.238,
  inputTokens: 10_000,
  outputTokens: 500,
  requests: 4,
};

function validAnswerFor(lens: Lens, id: string): SystemOneAnswer {
  const question = getLensDefinition(lens).questions[id].question;
  if (question.type === "noul") return { type: "noul", noul: 0.75 };
  if (question.type === "choice") {
    const options = Object.keys(question.criteria);
    return {
      type: "choice",
      choice: options[0],
      confidence: 0.8,
      probabilities: Object.fromEntries(
        options.map((option, index) => [option, index === 0 ? 1 : 0]),
      ),
    };
  }
  return {
    type: "score",
    score: (question.criteria.length - 1) / 2,
    confidence: 0.7,
    legend: Object.fromEntries(
      question.criteria.map((label, index) => [String(index), label]),
    ),
    probabilities: Object.fromEntries(
      question.criteria.map((_, index) => [String(index), index === 2 ? 1 : 0]),
    ),
  };
}

function validResponse(lens: Lens = "message"): SystemOneResponse {
  return {
    model: "jev-1.13.0",
    answers: Object.fromEntries(
      Object.keys(getLensDefinition(lens).questions).map((id) => [
        id,
        validAnswerFor(lens, id),
      ]),
    ),
    usage: { input_tokens: 1_250, output_tokens: 75 },
  };
}

function context(lens: Lens = "message") {
  return {
    lens,
    requestId: "request-test",
    durationMs: -4.4,
    analyzedAt: "2026-09-22T00:00:00.000Z",
    usageSnapshot,
  };
}

describe("analysis helpers", () => {
  it("clamps only finite probabilities", () => {
    expect(clampProbability(-0.2)).toBe(0);
    expect(clampProbability(0.4)).toBe(0.4);
    expect(clampProbability(1.2)).toBe(1);
    expect(clampProbability(Number.NaN)).toBe(0);
    expect(clampProbability(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("normalizes score indexes and handles invalid scales", () => {
    expect(normalizeScore(2.5, 5)).toBe(0.625);
    expect(normalizeScore(10, 5)).toBe(1);
    expect(normalizeScore(-1, 5)).toBe(0);
    expect(normalizeScore(1, 1)).toBe(0);
  });

  it("calculates cost from whole input tokens and counts Unicode characters", () => {
    expect(calculateCostUsd(1_000_000)).toBe(0.042);
    expect(calculateCostUsd(1_999.9)).toBe((1_999 / 1_000_000) * 0.042);
    expect(calculateCostUsd(-1)).toBe(0);
    expect(countCharacters("A\u{1F642}\u6C49")).toBe(3);
  });
});

describe("toVisualizationResponse", () => {
  it("normalizes valid Choice, Noul, and Score answers", () => {
    const response = validResponse();
    response.answers.tone = {
      type: "choice",
      choice: "guarded",
      confidence: 0.8,
      probabilities: {
        warm: 0.05,
        neutral: 0.1,
        assertive: 0.2,
        guarded: 0.6,
        hostile: 0.05,
      },
    };
    response.answers.urgency = {
      type: "score",
      score: 2.5,
      confidence: 0.7,
      legend: {},
      probabilities: { "0": 0.05, "1": 0.15, "2": 0.3, "3": 0.4, "4": 0.1 },
    };
    response.answers.reply_expected = { type: "noul", noul: 0.8 };

    const result = toVisualizationResponse(response, context());

    expect(result.choices.find(({ id }) => id === "tone")).toMatchObject({
      selected: "guarded",
      confidence: 0.8,
      options: [
        { id: "guarded", probability: 0.6 },
        { id: "assertive", probability: 0.2 },
        { id: "neutral", probability: 0.1 },
        { id: "warm", probability: 0.05 },
        { id: "hostile", probability: 0.05 },
      ],
    });
    expect(result.signals.find(({ id }) => id === "urgency")).toMatchObject({
      type: "score",
      value: 0.625,
      rawValue: 2.5,
      certainty: 0.7,
      certaintySource: "model_confidence",
      probabilities: [
        { id: "3", probability: 0.4 },
        { id: "2", probability: 0.3 },
        { id: "1", probability: 0.15 },
        { id: "4", probability: 0.1 },
        { id: "0", probability: 0.05 },
      ],
    });
    expect(
      result.signals.find(({ id }) => id === "reply_expected"),
    ).toMatchObject({
      type: "noul",
      value: 0.8,
      rawValue: 0.8,
      certainty: 0.6,
      certaintySource: "derived_probability_distance",
    });
    expect(result.meta).toMatchObject({
      lens: "message",
      model: "jev-1.13.0",
      usage: { inputTokens: 1_250, outputTokens: 75 },
      estimatedCostUsd: (1_250 / 1_000_000) * 0.042,
      requestId: "request-test",
      durationMs: 0,
      analyzedAt: "2026-09-22T00:00:00.000Z",
      ...usageSnapshot,
    });
  });

  it.each([
    ["out-of-range Noul", "reply_expected", { type: "noul", noul: 1.2 }],
    [
      "incomplete Choice distribution",
      "tone",
      { type: "choice", choice: "warm", confidence: 0.8, probabilities: { warm: 1 } },
    ],
    [
      "invalid Score distribution",
      "urgency",
      {
        type: "score",
        score: 2,
        confidence: 0.8,
        legend: {},
        probabilities: { "0": 0, "1": 0, "2": 2, "3": 0, "4": 0 },
      },
    ],
  ] as const)("rejects %s", (_name, id, invalidAnswer) => {
    const response = validResponse();
    response.answers[id] = invalidAnswer;
    expect(() => toVisualizationResponse(response, context())).toThrow(
      /answers.*questions/i,
    );
  });

  it("rejects a response with a missing answer", () => {
    const response = validResponse();
    delete response.answers.hidden_tension;

    expect(() => toVisualizationResponse(response, context())).toThrow(
      /answers.*questions/i,
    );
  });

  it.each([
    ["tone", { type: "noul", noul: 0.5 }],
    [
      "urgency",
      {
        type: "choice",
        choice: "unexpected",
        confidence: 1,
        probabilities: { unexpected: 1 },
      },
    ],
    [
      "reply_expected",
      {
        type: "score",
        score: 1,
        confidence: 1,
        legend: { "0": "no", "1": "yes" },
        probabilities: { "0": 0, "1": 1 },
      },
    ],
  ] as const)("rejects a type mismatch for %s", (id, mismatchedAnswer) => {
    const response = validResponse();
    response.answers[id] = mismatchedAnswer;

    expect(() => toVisualizationResponse(response, context())).toThrow(
      /answers.*questions/i,
    );
  });
});
