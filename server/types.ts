export type Lens = "message" | "pitch" | "story";

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria: {
    true: string;
    false: string;
  };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type SystemOneQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface QuestionDefinition {
  label: string;
  lowLabel?: string;
  highLabel?: string;
  optionLabels?: Record<string, string>;
  question: SystemOneQuestion;
}

export interface LensDefinition {
  id: Lens;
  label: string;
  questions: Record<string, QuestionDefinition>;
}

export interface SystemOneRequest {
  model: string;
  state: string;
  questions: Record<string, SystemOneQuestion>;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, unknown>;
  probabilities: Record<string, number>;
}

export type SystemOneAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, SystemOneAnswer>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface ProbabilityPoint {
  id: string;
  label: string;
  probability: number;
}

export interface VisualizationSignal {
  id: string;
  label: string;
  type: "noul" | "score";
  value: number;
  rawValue: number;
  certainty: number;
  certaintySource: "derived_probability_distance" | "model_confidence";
  lowLabel: string;
  highLabel: string;
  probabilities?: ProbabilityPoint[];
}

export interface VisualizationChoice {
  id: string;
  label: string;
  selected: string;
  selectedLabel: string;
  confidence: number;
  options: ProbabilityPoint[];
}

export interface UsageSnapshot {
  budgetUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export interface AnalyzeMeta extends UsageSnapshot {
  lens: Lens;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  estimatedCostUsd: number;
  requestId: string;
  durationMs: number;
  analyzedAt: string;
}

export interface AnalyzeResponse {
  signals: VisualizationSignal[];
  choices: VisualizationChoice[];
  meta: AnalyzeMeta;
}
