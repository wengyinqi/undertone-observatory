import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { calculateCostUsd } from "../server/analysis.js";
import {
  BudgetExceededError,
  UsageLedger,
} from "../server/usage.js";

describe("UsageLedger", () => {
  let temporaryDirectory: string;
  let ledgerPath: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "jev-usage-test-"));
    ledgerPath = join(temporaryDirectory, "nested", "usage.json");
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("persists committed usage and reloads it in a new instance", async () => {
    const ledger = new UsageLedger(ledgerPath, 0.25);

    const reserved = await ledger.reserve("request-1", 65_536);
    expect(reserved.reservedUsd).toBe(calculateCostUsd(65_536));
    expect(reserved.requests).toBe(0);

    const committed = await ledger.commit("request-1", {
      inputTokens: 12_345.9,
      outputTokens: 67.8,
    });
    expect(committed).toMatchObject({
      budgetUsd: 0.25,
      spentUsd: calculateCostUsd(12_345),
      reservedUsd: 0,
      inputTokens: 12_345,
      outputTokens: 67,
      requests: 1,
    });

    const reloaded = await new UsageLedger(ledgerPath, 0.25).snapshot();
    expect(reloaded).toEqual(committed);

    const stored = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      version: number;
      reservations: Record<string, unknown>;
    };
    expect(stored.version).toBe(1);
    expect(stored.reservations).toEqual({});
  });

  it("serializes concurrent reservations so the total cannot exceed budget", async () => {
    const budgetUsd = calculateCostUsd(1_000_000);
    const ledger = new UsageLedger(ledgerPath, budgetUsd);

    const results = await Promise.allSettled([
      ledger.reserve("first", 600_000),
      ledger.reserve("second", 600_000),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejection = results.find(({ status }) => status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: expect.any(BudgetExceededError),
    });

    const snapshot = await ledger.snapshot();
    expect(snapshot.reservedUsd).toBe(calculateCostUsd(600_000));
    expect(snapshot.spentUsd).toBe(0);
    expect(snapshot.remainingUsd).toBeCloseTo(
      budgetUsd - calculateCostUsd(600_000),
      12,
    );
  });

  it("releases a reservation without charging and permits the budget to be reused", async () => {
    const budgetUsd = calculateCostUsd(700_000);
    const ledger = new UsageLedger(ledgerPath, budgetUsd);
    await ledger.reserve("abandoned", 600_000);

    const released = await ledger.release("abandoned");
    expect(released).toMatchObject({
      spentUsd: 0,
      reservedUsd: 0,
      remainingUsd: budgetUsd,
      requests: 0,
    });

    await expect(ledger.reserve("replacement", 600_000)).resolves.toMatchObject({
      reservedUsd: calculateCostUsd(600_000),
    });
    await expect(ledger.release("unknown-id")).resolves.toMatchObject({
      reservedUsd: calculateCostUsd(600_000),
      spentUsd: 0,
    });
  });
});
