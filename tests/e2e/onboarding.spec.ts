import { test, expect } from "@playwright/test";

/**
 * E2E: Onboarding wizard flow (skip_llm mode).
 *
 * Walks through the OnboardingWizard:
 *   Step 1 — Name your company
 *   Step 2 — Choose a specialist coworker template → configure toolchain + adapter
 *   Step 3 — Launch workspace (starter task + Create Task & Launch)
 *
 * By default this runs in skip_llm mode: we do NOT assert that an LLM
 * heartbeat fires. Set BENCH_E2E_SKIP_LLM=false to enable LLM-dependent
 * assertions (requires a valid ANTHROPIC_API_KEY).
 */

const SKIP_LLM = process.env.BENCH_E2E_SKIP_LLM !== "false";

const COMPANY_NAME = `E2E-Test-${Date.now()}`;
/** Default template after onboarding step 2 (first in COWORKER_TEMPLATES). */
const AGENT_NAME = "Frontend Engineer";
const TASK_TITLE = "E2E test task";

/** Substring from default Frontend Engineer starter task body (see OnboardingWizard). */
const DEFAULT_TASK_BODY_SNIPPET = "onboarding stepper";

test.describe("Onboarding wizard", () => {
  test("completes full wizard flow", async ({ page }) => {
    await page.goto("/onboarding");

    const wizardHeading = page.locator("h3", { hasText: "Name your company" });

    await expect(wizardHeading).toBeVisible({ timeout: 5_000 });

    const companyNameInput = page.locator('input[placeholder="Acme Corp"]');
    await companyNameInput.fill(COMPANY_NAME);

    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.locator("h3", { hasText: "Choose a coworker" })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.locator("h3", { hasText: "Set up Frontend Engineer" })).toBeVisible({
      timeout: 30_000,
    });

    const agentNameInput = page.locator('input[placeholder="Frontend Engineer"]');
    await expect(agentNameInput).toHaveValue(AGENT_NAME);

    await page.getByRole("button", { name: "Slack", exact: true }).click();
    await page.getByRole("button", { name: "Outlook / Microsoft 365" }).click();

    await expect(
      page.locator("button", { hasText: "Claude Code" }).locator(".."),
    ).toBeVisible();

    await page.getByRole("button", { name: "More Agent Adapter Types" }).click();
    await expect(page.getByRole("button", { name: "Process" })).toHaveCount(0);

    const configureNext = page.getByRole("button", { name: "Next" }).filter({ hasText: "Next" });
    await configureNext.click();

    await expect(page.locator("h3", { hasText: "Launch workspace" })).toBeVisible({
      timeout: 120_000,
    });

    const baseUrl = page.url().split("/").slice(0, 3).join("/");
    if (SKIP_LLM) {
      const companiesAfterAgentRes = await page.request.get(`${baseUrl}/api/companies`);
      expect(companiesAfterAgentRes.ok()).toBe(true);
      const companiesAfterAgent = await companiesAfterAgentRes.json();
      const companyAfterAgent = companiesAfterAgent.find(
        (c: { name: string }) => c.name === COMPANY_NAME,
      );
      expect(companyAfterAgent).toBeTruthy();

      const agentsAfterCreateRes = await page.request.get(
        `${baseUrl}/api/companies/${companyAfterAgent.id}/agents`,
      );
      expect(agentsAfterCreateRes.ok()).toBe(true);
      const agentsAfterCreate = await agentsAfterCreateRes.json();
      const hiredAgent = agentsAfterCreate.find((a: { name: string }) => a.name === AGENT_NAME);
      expect(hiredAgent).toBeTruthy();

      const disableWakeRes = await page.request.patch(
        `${baseUrl}/api/agents/${hiredAgent.id}?companyId=${encodeURIComponent(companyAfterAgent.id)}`,
        {
          data: {
            runtimeConfig: {
              heartbeat: {
                enabled: false,
                intervalSec: 300,
                wakeOnDemand: false,
                cooldownSec: 10,
                maxConcurrentRuns: 5,
              },
            },
          },
        },
      );
      expect(disableWakeRes.ok()).toBe(true);
    }

    const taskTitleInput = page.locator(
      'input[placeholder="e.g. Research competitor pricing"]',
    );
    await taskTitleInput.clear();
    await taskTitleInput.fill(TASK_TITLE);

    await page.getByRole("button", { name: "Create Task & Launch" }).click();

    await expect(page).toHaveURL(/\/issues\//, { timeout: 30_000 });

    const companiesRes = await page.request.get(`${baseUrl}/api/companies`);
    expect(companiesRes.ok()).toBe(true);
    const companies = await companiesRes.json();
    const company = companies.find((c: { name: string }) => c.name === COMPANY_NAME);
    expect(company).toBeTruthy();

    const agentsRes = await page.request.get(`${baseUrl}/api/companies/${company.id}/agents`);
    expect(agentsRes.ok()).toBe(true);
    const agents = await agentsRes.json();
    const createdAgent = agents.find((a: { name: string }) => a.name === AGENT_NAME);
    expect(createdAgent).toBeTruthy();
    expect(createdAgent.role).toBe("engineer");
    expect(createdAgent.adapterType).not.toBe("process");

    const instructionsBundleRes = await page.request.get(
      `${baseUrl}/api/agents/${createdAgent.id}/instructions-bundle?companyId=${company.id}`,
    );
    expect(instructionsBundleRes.ok()).toBe(true);
    const instructionsBundle = await instructionsBundleRes.json();
    expect(
      instructionsBundle.files.map((file: { path: string }) => file.path).sort(),
    ).toEqual(["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"]);

    const issuesRes = await page.request.get(`${baseUrl}/api/companies/${company.id}/issues`);
    expect(issuesRes.ok()).toBe(true);
    const issues = await issuesRes.json();
    const task = issues.find((i: { title: string }) => i.title === TASK_TITLE);
    expect(task).toBeTruthy();
    expect(task.assigneeAgentId).toBe(createdAgent.id);
    expect(task.description).toContain(DEFAULT_TASK_BODY_SNIPPET);
    expect(task.description).not.toContain("github.com/bench/companies");

    if (!SKIP_LLM) {
      await expect(async () => {
        const res = await page.request.get(`${baseUrl}/api/issues/${task.id}`);
        const issue = await res.json();
        expect(["in_progress", "done"]).toContain(issue.status);
      }).toPass({ timeout: 120_000, intervals: [5_000] });
    } else {
      await expect
        .poll(
          async () => {
            const runsRes = await page.request.get(
              `${baseUrl}/api/companies/${company.id}/heartbeat-runs?agentId=${createdAgent.id}`,
            );
            expect(runsRes.ok()).toBe(true);
            const runs = await runsRes.json();
            return Array.isArray(runs) ? runs.length : -1;
          },
          { timeout: 10_000, intervals: [500, 1_000, 2_000] },
        )
        .toBe(0);
    }
  });
});
