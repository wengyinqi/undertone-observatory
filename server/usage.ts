import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { calculateCostUsd } from "./analysis.js";
import type { SystemOneRequest, UsageSnapshot } from "./types.js";

const DEFAULT_BUDGET_USD = 0.25;
const DEFAULT_RESERVATION_TOKEN_FLOOR = 65_536;
const DEFAULT_STALE_RESERVATION_MS = 2 * 60 * 1_000;

interface UsageReservation {
  maxInputTokens: number;
  amountUsd: number;
  createdAt: string;
}

interface StoredUsageLedger {
  version: 1;
  spentUsd: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  updatedAt: string;
  reservations: Record<string, UsageReservation>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export class BudgetExceededError extends Error {
  readonly code = "BUDGET_EXCEEDED";

  constructor(
    readonly requiredUsd: number,
    readonly remainingUsd: number,
  ) {
    super("The configured usage budget has been reached.");
    this.name = "BudgetExceededError";
  }
}

export class LedgerLockError extends Error {
  readonly code = "LEDGER_LOCKED";

  constructor() {
    super("The usage ledger is already owned by another server process.");
    this.name = "LedgerLockError";
  }
}

export function parsePositiveNumber(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveBudgetUsd(value = process.env.TYPESAFE_BUDGET_USD): number {
  if (value === undefined || value.trim() === "") return DEFAULT_BUDGET_USD;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BUDGET_USD;
}

export function defaultUsageLedgerPath(cwd = process.cwd()): string {
  return resolve(cwd, "data", "usage.json");
}

export function estimateReservationTokens(
  request: SystemOneRequest,
  tokenFloor = DEFAULT_RESERVATION_TOKEN_FLOOR,
): number {
  const utf8Bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
  // A byte-level upper bound plus a large allowance for service-side framing.
  return Math.max(Math.ceil(tokenFloor), utf8Bytes + 32_768);
}

export function sumReservedUsd(
  reservations: Record<string, UsageReservation>,
): number {
  return Object.values(reservations).reduce(
    (total, reservation) => total + reservation.amountUsd,
    0,
  );
}

export function createUsageSnapshot(
  ledger: StoredUsageLedger,
  budgetUsd: number,
): UsageSnapshot {
  const reservedUsd = sumReservedUsd(ledger.reservations);
  return {
    budgetUsd,
    spentUsd: ledger.spentUsd,
    reservedUsd,
    remainingUsd: Math.max(0, budgetUsd - ledger.spentUsd - reservedUsd),
    inputTokens: ledger.inputTokens,
    outputTokens: ledger.outputTokens,
    requests: ledger.requests,
  };
}

function emptyLedger(now = new Date().toISOString()): StoredUsageLedger {
  return {
    version: 1,
    spentUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    requests: 0,
    updatedAt: now,
    reservations: {},
  };
}

function requireNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Usage ledger has an invalid ${field}.`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  const parsed = requireNonNegativeNumber(value, field);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Usage ledger has an invalid ${field}.`);
  }
  return parsed;
}

function normalizeUsageInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function getErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}

export function parseStoredLedger(value: unknown): StoredUsageLedger {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Usage ledger must be a JSON object.");
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) {
    throw new Error("Usage ledger has an unsupported version.");
  }
  if (
    typeof candidate.reservations !== "object" ||
    candidate.reservations === null ||
    Array.isArray(candidate.reservations)
  ) {
    throw new Error("Usage ledger has invalid reservations.");
  }
  if (typeof candidate.updatedAt !== "string") {
    throw new Error("Usage ledger has an invalid update timestamp.");
  }
  const rawReservations = candidate.reservations as Record<string, unknown>;
  const reservations: Record<string, UsageReservation> = {};

  for (const [id, rawReservation] of Object.entries(rawReservations)) {
    if (
      typeof rawReservation !== "object" ||
      rawReservation === null ||
      Array.isArray(rawReservation)
    ) {
      throw new Error("Usage ledger has an invalid reservation.");
    }
    const reservation = rawReservation as Record<string, unknown>;
    const maxInputTokens = requireNonNegativeInteger(
      reservation.maxInputTokens,
      "reservation token count",
    );
    const amountUsd = requireNonNegativeNumber(
      reservation.amountUsd,
      "reservation amount",
    );
    if (maxInputTokens === 0 || amountUsd === 0) {
      throw new Error("Usage ledger has an empty reservation.");
    }
    if (typeof reservation.createdAt !== "string") {
      throw new Error("Usage ledger has an invalid reservation timestamp.");
    }
    reservations[id] = {
      maxInputTokens,
      amountUsd,
      createdAt: reservation.createdAt,
    };
  }

  return {
    version: 1,
    spentUsd: requireNonNegativeNumber(candidate.spentUsd, "spent amount"),
    inputTokens: requireNonNegativeInteger(
      candidate.inputTokens,
      "input token count",
    ),
    outputTokens: requireNonNegativeInteger(
      candidate.outputTokens,
      "output token count",
    ),
    requests: requireNonNegativeInteger(candidate.requests, "request count"),
    updatedAt: candidate.updatedAt,
    reservations,
  };
}

export class UsageLedger {
  private state: StoredUsageLedger | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private processLockHandle: FileHandle | undefined;
  private processLockToken: string | undefined;

  constructor(
    readonly filePath = defaultUsageLedgerPath(),
    readonly budgetUsd = resolveBudgetUsd(),
    private readonly now: () => number = Date.now,
    readonly staleReservationMs = DEFAULT_STALE_RESERVATION_MS,
  ) {}

  get lockPath(): string {
    return `${this.filePath}.lock`;
  }

  private withLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async load(): Promise<StoredUsageLedger> {
    if (this.state) return this.state;
    try {
      const contents = await readFile(this.filePath, "utf8");
      this.state = parseStoredLedger(JSON.parse(contents) as unknown);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (code !== "ENOENT") throw error;
      this.state = emptyLedger(new Date(this.now()).toISOString());
    }
    return this.state;
  }

  private async persist(next: StoredUsageLedger): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      flag: "w",
    });
    await rename(temporaryPath, this.filePath);
    this.state = next;
  }

  private async loadReconciled(): Promise<StoredUsageLedger> {
    const current = await this.load();
    const nowMs = this.now();
    const staleIds = Object.entries(current.reservations)
      .filter(([, reservation]) => {
        const createdAtMs = Date.parse(reservation.createdAt);
        return (
          !Number.isFinite(createdAtMs) ||
          nowMs - createdAtMs >= this.staleReservationMs
        );
      })
      .map(([id]) => id);

    if (staleIds.length === 0) return current;

    const reservations = { ...current.reservations };
    let spentUsd = current.spentUsd;
    let inputTokens = current.inputTokens;
    for (const id of staleIds) {
      const reservation = reservations[id];
      if (!reservation) continue;
      spentUsd += reservation.amountUsd;
      inputTokens += reservation.maxInputTokens;
      delete reservations[id];
    }

    const reconciled: StoredUsageLedger = {
      ...current,
      spentUsd,
      inputTokens,
      requests: current.requests + staleIds.length,
      updatedAt: new Date(nowMs).toISOString(),
      reservations,
    };
    await this.persist(reconciled);
    return reconciled;
  }

  async acquireProcessLock(): Promise<void> {
    if (this.processLockHandle) return;
    await mkdir(dirname(this.lockPath), { recursive: true });
    const token = randomUUID();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(this.lockPath, "wx", 0o600);
        try {
          await handle.writeFile(
            `${JSON.stringify({
              pid: process.pid,
              token,
              createdAt: new Date(this.now()).toISOString(),
            })}\n`,
            "utf8",
          );
          await handle.sync();
        } catch (error) {
          await handle.close();
          await unlink(this.lockPath).catch(() => undefined);
          throw error;
        }
        this.processLockHandle = handle;
        this.processLockToken = token;
        return;
      } catch (error) {
        const code = getErrorCode(error);
        if (code !== "EEXIST") throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
        if (await this.hasLiveLockOwner()) throw new LedgerLockError();
        try {
          await unlink(this.lockPath);
        } catch (unlinkError) {
          if (getErrorCode(unlinkError) !== "ENOENT") throw unlinkError;
        }
      }
    }

    throw new LedgerLockError();
  }

  async releaseProcessLock(): Promise<void> {
    const handle = this.processLockHandle;
    const token = this.processLockToken;
    this.processLockHandle = undefined;
    this.processLockToken = undefined;
    if (!handle || !token) return;

    await handle.close();
    try {
      const contents = JSON.parse(await readFile(this.lockPath, "utf8")) as {
        token?: unknown;
      };
      if (contents.token === token) await unlink(this.lockPath);
    } catch (error) {
      if (getErrorCode(error) !== "ENOENT") throw error;
    }
  }

  private async hasLiveLockOwner(): Promise<boolean> {
    let owner: { pid?: unknown };
    try {
      owner = JSON.parse(await readFile(this.lockPath, "utf8")) as {
        pid?: unknown;
      };
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") return false;
      return this.isLockFileFresh();
    }
    if (!Number.isInteger(owner.pid) || Number(owner.pid) <= 0) {
      return this.isLockFileFresh();
    }
    try {
      process.kill(Number(owner.pid), 0);
      return true;
    } catch (error) {
      return getErrorCode(error) !== "ESRCH";
    }
  }

  private async isLockFileFresh(): Promise<boolean> {
    try {
      const metadata = await stat(this.lockPath);
      return Date.now() - metadata.mtimeMs < 10_000;
    } catch {
      return false;
    }
  }

  snapshot(): Promise<UsageSnapshot> {
    return this.withLock(async () =>
      createUsageSnapshot(await this.loadReconciled(), this.budgetUsd),
    );
  }

  reserve(
    reservationId: string,
    maxInputTokens: number,
  ): Promise<UsageSnapshot> {
    return this.withLock(async () => {
      const current = await this.loadReconciled();
      if (current.reservations[reservationId]) {
        throw new Error("Duplicate usage reservation.");
      }

      const amountUsd = calculateCostUsd(maxInputTokens);
      const snapshot = createUsageSnapshot(current, this.budgetUsd);
      if (amountUsd > snapshot.remainingUsd + Number.EPSILON) {
        throw new BudgetExceededError(amountUsd, snapshot.remainingUsd);
      }

      const next: StoredUsageLedger = {
        ...current,
        updatedAt: new Date(this.now()).toISOString(),
        reservations: {
          ...current.reservations,
          [reservationId]: {
            maxInputTokens,
            amountUsd,
            createdAt: new Date(this.now()).toISOString(),
          },
        },
      };
      await this.persist(next);
      return createUsageSnapshot(next, this.budgetUsd);
    });
  }

  commit(
    reservationId: string,
    usage: TokenUsage,
  ): Promise<UsageSnapshot> {
    return this.withLock(async () => {
      const current = await this.loadReconciled();
      if (!current.reservations[reservationId]) {
        throw new Error("Usage reservation does not exist.");
      }

      const reservations = { ...current.reservations };
      delete reservations[reservationId];
      const inputTokens = normalizeUsageInteger(usage.inputTokens);
      const outputTokens = normalizeUsageInteger(usage.outputTokens);
      const next: StoredUsageLedger = {
        ...current,
        spentUsd: current.spentUsd + calculateCostUsd(inputTokens),
        inputTokens: current.inputTokens + inputTokens,
        outputTokens: current.outputTokens + outputTokens,
        requests: current.requests + 1,
        updatedAt: new Date(this.now()).toISOString(),
        reservations,
      };
      await this.persist(next);
      return createUsageSnapshot(next, this.budgetUsd);
    });
  }

  release(reservationId: string): Promise<UsageSnapshot> {
    return this.withLock(async () => {
      const current = await this.loadReconciled();
      if (!current.reservations[reservationId]) {
        return createUsageSnapshot(current, this.budgetUsd);
      }
      const reservations = { ...current.reservations };
      delete reservations[reservationId];
      const next: StoredUsageLedger = {
        ...current,
        updatedAt: new Date(this.now()).toISOString(),
        reservations,
      };
      await this.persist(next);
      return createUsageSnapshot(next, this.budgetUsd);
    });
  }
}

export const USAGE_DEFAULTS = {
  budgetUsd: DEFAULT_BUDGET_USD,
  reservationTokenFloor: DEFAULT_RESERVATION_TOKEN_FLOOR,
  staleReservationMs: DEFAULT_STALE_RESERVATION_MS,
} as const;
