import { describe, expect, it } from "vitest";

import {
  buildQuestions,
  buildSystemOneRequest,
  getLensDefinition,
  LENS_DEFINITIONS,
} from "../server/lenses.js";
import type { Lens } from "../server/types.js";

const LENSES: Lens[] = ["message", "pitch", "story"];

describe("lens definitions", () => {
  it("defines a balanced, valid question set for every lens", () => {
    expect(Object.keys(LENS_DEFINITIONS)).toEqual(LENSES);

    for (const lens of LENSES) {
      const definition = getLensDefinition(lens);
      const questions = buildQuestions(lens);

      expect(definition.id).toBe(lens);
      expect(definition.label.trim()).not.toBe("");
      expect(Object.keys(questions)).toEqual(Object.keys(definition.questions));
      expect(Object.values(questions).map(({ type }) => type).sort()).toEqual([
        "choice",
        "choice",
        "noul",
        "noul",
        "score",
        "score",
      ]);

      for (const [id, question] of Object.entries(questions)) {
        expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(question.instructions.trim()).not.toBe("");

        if (question.type === "choice") {
          expect(Object.keys(question.criteria).length).toBeGreaterThanOrEqual(2);
          expect(Object.keys(question.criteria).length).toBeLessThanOrEqual(255);
        } else if (question.type === "score") {
          expect(question.criteria.length).toBeGreaterThanOrEqual(2);
          expect(question.criteria.length).toBeLessThanOrEqual(10);
        } else {
          expect(question.criteria.true.trim()).not.toBe("");
          expect(question.criteria.false.trim()).not.toBe("");
        }
      }
    }
  });

  it("builds the exact upstream request without putting UI labels in state", () => {
    const request = buildSystemOneRequest(
      "A deliberately unchanged input.",
      "pitch",
      "jev-1.13.0",
    );

    expect(request).toEqual({
      model: "jev-1.13.0",
      state: "A deliberately unchanged input.",
      questions: buildQuestions("pitch"),
    });
    expect(Object.keys(request.questions)).toEqual(
      Object.keys(LENS_DEFINITIONS.pitch.questions),
    );
  });
});
