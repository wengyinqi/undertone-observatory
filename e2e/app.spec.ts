import { expect, test, type Page } from "@playwright/test";

const status = {
  ok: true,
  configured: true,
  model: "jev-latest",
  lenses: ["message", "pitch", "story"],
  limits: { maxTextCharacters: 6000, concurrency: 2 },
  pricing: { inputUsdPerMillionTokens: 0.042, outputUsdPerMillionTokens: 0 },
  usage: {
    budgetUsd: 0.25,
    spentUsd: 0.000084,
    reservedUsd: 0,
    remainingUsd: 0.249916,
    inputTokens: 2000,
    outputTokens: 120,
    requests: 2,
  },
  inFlight: { active: 0, queued: 0 },
};

function analysis(lens: string, variant = false) {
  return {
    signals: [
      {
        id: "urgency",
        label: "紧迫度",
        type: "score",
        value: variant ? 0.42 : 0.76,
        rawValue: variant ? 1.68 : 3.04,
        certainty: 0.82,
        certaintySource: "model_confidence",
        lowLabel: "可以等待",
        highLabel: "立即处理",
        probabilities: [],
      },
      {
        id: "clarity",
        label: "表达清晰度",
        type: "score",
        value: variant ? 0.84 : 0.68,
        rawValue: variant ? 3.36 : 2.72,
        certainty: 0.74,
        certaintySource: "model_confidence",
        lowLabel: "难以理解",
        highLabel: "一目了然",
        probabilities: [],
      },
      {
        id: "reply_expected",
        label: "期待回复",
        type: "noul",
        value: variant ? 0.37 : 0.91,
        rawValue: variant ? 0.37 : 0.91,
        certainty: variant ? 0.26 : 0.82,
        certaintySource: "derived_probability_distance",
        lowLabel: "无需回复",
        highLabel: "需要回应",
      },
      {
        id: "hidden_tension",
        label: "潜在张力",
        type: "noul",
        value: variant ? 0.2 : 0.73,
        rawValue: variant ? 0.2 : 0.73,
        certainty: variant ? 0.6 : 0.46,
        certaintySource: "derived_probability_distance",
        lowLabel: "坦然直接",
        highLabel: "暗含摩擦",
      },
    ],
    choices: [
      {
        id: "tone",
        label: "主导语气",
        selected: variant ? "warm" : "guarded",
        selectedLabel: variant ? "温暖" : "戒备",
        confidence: 0.78,
        options: [
          { id: "guarded", label: "戒备", probability: variant ? 0.12 : 0.57 },
          { id: "assertive", label: "坚定", probability: 0.22 },
          { id: "warm", label: "温暖", probability: variant ? 0.56 : 0.11 },
          { id: "neutral", label: "中性", probability: 0.1 },
        ],
      },
      {
        id: "intent",
        label: "核心意图",
        selected: "request",
        selectedLabel: "请求",
        confidence: 0.72,
        options: [
          { id: "request", label: "请求", probability: 0.64 },
          { id: "inform", label: "告知", probability: 0.21 },
          { id: "confront", label: "交涉", probability: 0.15 },
        ],
      },
    ],
    meta: {
      lens,
      model: "jev-1.13.0",
      usage: { inputTokens: 821, outputTokens: 74 },
      estimatedCostUsd: 0.000034482,
      budgetUsd: 0.25,
      spentUsd: 0.000118482,
      reservedUsd: 0,
      remainingUsd: 0.249881518,
      inputTokens: 2821,
      outputTokens: 194,
      requests: 3,
      requestId: variant ? "mock-b" : "mock-a",
      durationMs: 386,
      analyzedAt: "2026-09-22T06:00:00.000Z",
    },
  };
}

async function mockApi(page: Page) {
  let calls = 0;
  await page.route("**/api/status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(status) }),
  );
  await page.route("**/api/analyze", async (route) => {
    calls += 1;
    const body = route.request().postDataJSON() as { lens: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(analysis(body.lens, calls % 2 === 0)),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
});

test("analyzes a sample and renders its signal fingerprint", async ({ page }, testInfo) => {
  await expect(page.getByRole("heading", { name: /看见文字里的/ })).toBeVisible();
  await expect(page.locator(".api-status.is-online")).toBeVisible();
  await page.getByRole("button", { name: "开始观测" }).click();

  await expect(page.getByRole("img", { name: "文字信号雷达图" })).toBeVisible();
  await expect(page.getByText("主导语气")).toBeVisible();
  await expect(page.getByText("jev-1.13.0")).toBeVisible();
  await expect(page.getByText("中文信号仅供探索，低确定项建议人工判断。")).toBeVisible();
  await page.screenshot({
    path: `artifacts/undertone-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("compares two samples without horizontal overflow", async ({ page }) => {
  await page.locator(".compare-toggle").click();
  await page.locator(".comparison-field textarea").fill("收到，谢谢。这个版本我没有补充意见，可以继续推进。明天同步最终排期即可。");
  await page.getByRole("button", { name: "开始对照" }).click();

  await expect(page.getByText("样本 B", { exact: true })).toBeVisible();
  await expect(page.locator(".comparison-value").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
