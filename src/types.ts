export type Lens = "message" | "pitch" | "story";

export interface Signal {
  id: string;
  label: string;
  type: "score" | "noul";
  value: number;
  rawValue: number;
  certainty: number;
  certaintySource: "derived_probability_distance" | "model_confidence" | string;
  lowLabel: string;
  highLabel: string;
  probabilities?: ChoiceOption[];
}

export interface ChoiceOption {
  id: string;
  label: string;
  probability: number;
}

export interface ChoiceResult {
  id: string;
  label: string;
  selected: string;
  selectedLabel?: string;
  confidence: number;
  options: ChoiceOption[];
}

export interface AnalysisMeta {
  lens: Lens;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  estimatedCostUsd: number;
  budgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
  requestId: string;
  durationMs: number;
  analyzedAt: string;
}

export interface AnalysisResponse {
  signals: Signal[];
  choices: ChoiceResult[];
  meta: AnalysisMeta;
}

export interface StatusResponse {
  ok?: boolean;
  configured: boolean;
  model: string;
  usage?: {
    budgetUsd?: number;
    spentUsd?: number;
    reservedUsd?: number;
    remainingUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    requests?: number;
  };
  inFlight?: { active: number; queued: number };
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    retryAfterMs?: number;
  };
}

export interface AnalysisPair {
  primary: AnalysisResponse;
  secondary?: AnalysisResponse;
}

export interface HistoryEntry extends AnalysisPair {
  id: string;
  lens: Lens;
  text: string;
  comparisonText?: string;
  createdAt: string;
}

export class ApiError extends Error {
  code: string;
  retryable: boolean;
  retryAfterMs?: number;

  constructor(message: string, code = "REQUEST_FAILED", retryable = false, retryAfterMs?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}
