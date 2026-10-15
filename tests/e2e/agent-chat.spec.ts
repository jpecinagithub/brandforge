/**
 * E2E: agent chat — run progress card, approval flow, cancel, durable stream
 * fallback, active-run restoration, and the runs history.
 *
 * TEST STRATEGY (documented choice — approach (b)):
 *
 * The Phase-3 agent endpoints (POST /messages → run, SSE /agent/runs/{id}/events,
 * approve/cancel, runs list/detail) are being built in parallel by the backend
 * agent, so this spec does NOT assert real backend behaviour. Instead:
 *  - the browser's `fetch` POST /api/v1/conversations/{id}/messages is routed to
 *    return a canned `{message, run}` shaped exactly like the API contract in
 *    the task (AgentRun from @brandforge/shared);
 *  - `window.EventSource` is replaced (page.addInitScript) with a scriptable
 *    mock that emits the contract's SSE event frames
 *    (`{id, runId, seq, type, payload, createdAt}`), so the spec drives every
 *    UI state the progress card supports;
 *  - everything else (auth cookie, campaign creation, GET conversation reload,
 *    runs list/detail when explicitly routed) goes through the REAL test API.
 *
 * The honest AI_NOT_CONFIGURED stub path against the real backend is already
 * covered by tests/e2e/demo.spec.ts; this spec covers the agentic path.
 */
import { test, expect, type Page } from '@playwright/test';
import type { AgentRun } from '@brandforge/shared';

const API = 'http://localhost:3014';
const RUN_ID = '11111111-2222-3333-4444-555555555555';
const RUN_ID_2 = '66666666-7777-8888-9999-000000000000';

test.beforeEach(async ({ page, request }) => {
  const res = await request.post(`${API}/api/v1/auth/demo`);
  expect(res.ok()).toBeTruthy();
  const setCookie = res.headers()['set-cookie'] ?? '';
  const token = /bf_session=([^;]+)/.exec(setCookie)?.[1];
  expect(token).toBeTruthy();
  await page.context().addCookies([{ name: 'bf_session', value: token!, domain: 'localhost', path: '/' }]);

  // Scriptable EventSource mock (see header): emits contract-shaped SSE frames
  // on demand via window.__mockES.instances[last].emitMessage(frame).
  await page.addInitScript(() => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      url: string;
      readyState = MockEventSource.CONNECTING;
      onmessage: ((e: { data: string }) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onopen: ((e: unknown) => void) | null = null;
      private listeners: Record<string, Array<(e: unknown) => void>> = {};
      constructor(url: string, opts?: { withCredentials?: boolean }) {
        this.url = String(url);
        void opts;
        MockEventSource.instances.push(this);
        const w = window as unknown as { __mockESFailNext?: boolean };
        if (w.__mockESFailNext) {
          w.__mockESFailNext = false;
          queueMicrotask(() => {
            this.readyState = MockEventSource.CLOSED;
            if (this.onerror) this.onerror(new Event('error'));
          });
        } else {
          queueMicrotask(() => {
            this.readyState = MockEventSource.OPEN;
            if (this.onopen) this.onopen(new Event('open'));
          });
        }
      }
      emitMessage(data: unknown) {
        if (this.onmessage) this.onmessage({ data: typeof data === 'string' ? data : JSON.stringify(data) });
      }
      addEventListener(type: string, fn: (e: unknown) => void) {
        (this.listeners[type] = this.listeners[type] || []).push(fn);
      }
      removeEventListener(type: string, fn: (e: unknown) => void) {
        this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
      }
      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }
    const w = window as unknown as { __mockES: typeof MockEventSource; __mockESFailNext: boolean; EventSource: unknown };
    w.__mockES = MockEventSource;
    w.__mockESFailNext = false;
    w.EventSource = MockEventSource;
  });
});

function fakeRun(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    campaignId: '00000000-0000-0000-0000-000000000000',
    conversationId: null,
    state: 'running',
    input: 'Design a launch campaign',
    plan: null,
    completedSteps: 0,
    totalSteps: 3,
    costUsd: null,
    error: null,
    approval: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const fakeUserMsg = {
  id: 'msg-user-1',
  role: 'user',
  content: 'Design a launch campaign',
  createdAt: new Date().toISOString(),
};

async function emitAgentEvent(
  page: Page,
  runId: string,
  seq: number,
  type: string,
  payload: Record<string, unknown>,
) {
  await page.evaluate(
    ({ t, p, r, s }) => {
      const inst = (window as unknown as { __mockES: { instances: Array<{ emitMessage: (d: unknown) => void }> } }).__mockES.instances;
      inst[inst.length - 1].emitMessage({
        id: `evt-${s}`,
        runId: r,
        seq: s,
        type: t,
        payload: p,
        createdAt: new Date().toISOString(),
      });
    },
    { t: type, p: payload, r: runId, s: seq },
  );
}

/** Route POST /messages → canned {message, run}; GET run detail → {run, steps}. */
async function mockAgenticChat(page: Page, runId: string) {
  await page.route('**/api/v1/conversations/*/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: fakeUserMsg, run: fakeRun(runId) }),
    });
  });
  await page.route('**/api/v1/agent/runs/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ run: fakeRun(runId), steps: [] }),
    });
  });
}

async function createCampaignAndOpenWorkspace(page: Page): Promise<string> {
  const campaignName = `E2E Agent ${Date.now()}`;
  await page.goto('/app');
  await page.getByRole('button', { name: 'New Campaign' }).first().click();
  await page.getByLabel('Campaign name').fill(campaignName);
  await page.getByLabel('Main objective').fill('Create a complete launch campaign');
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page).toHaveURL(/\/app\/campaigns\/.+/);
  return campaignName;
}

async function sendChatMessage(page: Page, text: string) {
  await page.getByLabel('Agent chat').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

test('run streams steps, tools, usage and approval — approve → finished', async ({ page }) => {
  await mockAgenticChat(page, RUN_ID);

  let approveBody: unknown = null;
  await page.route('**/api/v1/agent/runs/*/approve', async (route) => {
    approveBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ run: fakeRun(RUN_ID, { state: 'running' }) }),
    });
  });

  await createCampaignAndOpenWorkspace(page);
  await sendChatMessage(page, 'Design a launch campaign');

  const card = page.getByTestId('agent-run-card');
  await expect(card).toBeVisible();
  await expect(card.getByText('Running')).toBeVisible();
  await expect(card.getByText('0 of 3 steps')).toBeVisible();

  // stream the contract's event frames in order
  await emitAgentEvent(page, RUN_ID, 1, 'run.started', {});
  await emitAgentEvent(page, RUN_ID, 2, 'step.started', {
    stepId: 's1',
    title: 'Draft campaign concepts',
    tool: 'generate_marketing_copy',
  });
  await expect(card.getByText('Draft campaign concepts')).toBeVisible();

  await emitAgentEvent(page, RUN_ID, 3, 'tool.completed', {
    tool: 'generate_marketing_copy',
    summary: '3 concepts drafted',
    ok: true,
  });
  await expect(card.getByText('3 concepts drafted')).toBeVisible();

  await emitAgentEvent(page, RUN_ID, 4, 'run.progress', { completedSteps: 1, totalSteps: 3, currentStep: 's2' });
  await expect(card.getByText('1 of 3 steps')).toBeVisible();

  await emitAgentEvent(page, RUN_ID, 5, 'step.completed', { stepId: 's1', title: 'Draft campaign concepts' });

  await emitAgentEvent(page, RUN_ID, 6, 'usage', {
    model: 'openrouter/test-model',
    tokensIn: 1200,
    tokensOut: 800,
    costUsd: '0.0042',
  });
  await expect(card.getByText('2000 tokens')).toBeVisible();
  await expect(card.getByText(/\$0\.0042/)).toBeVisible();

  // approval gate
  await emitAgentEvent(page, RUN_ID, 7, 'run.waiting_approval', {
    reason: 'Image generation exceeds the free budget',
    requestedBudgetUsd: 2.5,
  });
  await expect(card.getByText('Waiting for approval')).toBeVisible();
  await expect(card.getByText('Image generation exceeds the free budget')).toBeVisible();
  await expect(card.getByText(/\$2\.5/)).toBeVisible();

  await card.getByLabel('Raise budget (USD, optional)').fill('5');
  const [approveRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/approve') && r.request().method() === 'POST'),
    card.getByRole('button', { name: 'Approve' }).click(),
  ]);
  expect(approveRes.ok()).toBeTruthy();
  expect(approveBody).toEqual({ approved: true, budgetUsd: 5 });

  // server resumes the run — approval block clears
  await emitAgentEvent(page, RUN_ID, 8, 'run.state', { state: 'running' });
  await expect(card.getByText('Waiting for approval')).toHaveCount(0);

  // finished: card marked done, thread reloaded from the real API
  const reload = page.waitForResponse(
    (r) => r.url().includes('/conversation') && r.request().method() === 'GET',
  );
  await emitAgentEvent(page, RUN_ID, 9, 'run.finished', {
    state: 'completed',
    summary: 'Campaign draft ready for review.',
  });
  await expect(card.getByText('Completed')).toBeVisible();
  await expect(card.getByText('Campaign draft ready for review.')).toBeVisible();
  const reloaded = await reload;
  expect(reloaded.ok()).toBeTruthy();
});

test('cancel stops the run', async ({ page }) => {
  await mockAgenticChat(page, RUN_ID_2);
  await page.route('**/api/v1/agent/runs/*/cancel', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ run: fakeRun(RUN_ID_2, { state: 'cancelled' }) }) });
  });

  await createCampaignAndOpenWorkspace(page);
  await sendChatMessage(page, 'Design a launch campaign');

  const card = page.getByTestId('agent-run-card');
  await expect(card).toBeVisible();

  const [cancelRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/cancel') && r.request().method() === 'POST'),
    card.getByRole('button', { name: 'Cancel', exact: true }).click(),
  ]);
  expect(cancelRes.ok()).toBeTruthy();

  await emitAgentEvent(page, RUN_ID_2, 10, 'run.finished', { state: 'cancelled', summary: null });
  await expect(card.getByText('Cancelled')).toBeVisible();
});

test('stream error falls back to polling and finishes without user action', async ({ page }) => {
  await mockAgenticChat(page, RUN_ID);
  let polledState: AgentRun['state'] = 'running';
  await page.route('**/api/v1/agent/runs/*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ run: fakeRun(RUN_ID, { state: polledState }), steps: [] }),
    });
  });
  await createCampaignAndOpenWorkspace(page);

  // make the NEXT EventSource instance fail on open
  await page.evaluate(() => {
    (window as unknown as { __mockESFailNext: boolean }).__mockESFailNext = true;
  });
  await sendChatMessage(page, 'Design a launch campaign');

  const card = page.getByTestId('agent-run-card');
  await expect(card).toBeVisible();
  await expect(card.getByText('Keeping the progress in sync automatically')).toBeVisible();

  polledState = 'completed';
  await expect(card.getByText('Completed')).toBeVisible({ timeout: 7000 });
  await expect(card.getByText('Keeping the progress in sync automatically')).toHaveCount(0);
});

test('an active run is restored when the workspace is reopened', async ({ page }) => {
  await page.route('**/api/v1/campaigns/*/agent/runs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ runs: [fakeRun(RUN_ID)] }),
    });
  });
  await page.route('**/api/v1/agent/runs/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ run: fakeRun(RUN_ID), steps: [] }),
    });
  });

  await createCampaignAndOpenWorkspace(page);
  const card = page.getByTestId('agent-run-card');
  await expect(card).toBeVisible();
  await expect(card.getByText('Running')).toBeVisible();
});

test('runs history lists runs and shows step detail (mobile layout)', async ({ page }) => {
  const doneRun = fakeRun(RUN_ID, { state: 'completed', costUsd: '0.0120' });
  const detailSteps = [
    { id: 'st-1', stepNo: 1, title: 'Draft campaign concepts', tool: 'generate_marketing_copy', state: 'completed', error: null },
    { id: 'st-2', stepNo: 2, title: 'Review copy', tool: 'review_campaign', state: 'failed', error: 'Tone mismatch' },
  ];
  await page.route('**/api/v1/campaigns/*/agent/runs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ runs: [doneRun] }),
    });
  });
  await page.route('**/api/v1/agent/runs/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ run: doneRun, steps: detailSteps }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await createCampaignAndOpenWorkspace(page);

  // mobile: switch to the chat column
  await page.getByRole('tab', { name: 'Agent chat' }).click();

  await page.getByRole('button', { name: /Agent runs/ }).click();
  await expect(page.getByText('Completed').first()).toBeVisible();
  await expect(page.getByText('$0.0120')).toBeVisible();

  await page.getByText('$0.0120').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Run detail')).toBeVisible();
  await expect(dialog.getByText('Draft campaign concepts')).toBeVisible();
  await expect(dialog.getByText('Tone mismatch')).toBeVisible();
  await expect(dialog.getByText('Total cost: $0.0120')).toBeVisible();
});
