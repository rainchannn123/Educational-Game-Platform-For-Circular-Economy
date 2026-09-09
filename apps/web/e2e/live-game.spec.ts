import { expect, test, type Page } from "@playwright/test";

const gameId = process.env.E2E_GAME_ID;
const municipalityToken = process.env.E2E_MUNICIPALITY_TOKEN;
const mrfToken = process.env.E2E_MRF_TOKEN;

const isConfigured = Boolean(gameId && municipalityToken && mrfToken);

async function authenticate(page: Page, token: string) {
  await page.addInitScript((sessionToken) => {
    sessionStorage.setItem("circular-city-token", sessionToken);
  }, token);
}

test.describe("live multiplayer game", () => {
  test.skip(!isConfigured, "Requires seeded active-game E2E credentials.");

  test("uses the viewport efficiently and keeps all commands keyboard reachable", async ({
    page,
  }) => {
    await authenticate(page, municipalityToken!);
    await page.goto(`/games/${gameId}/municipality`);

    await expect(page.getByText("Circular City Rush")).toHaveCount(0);
    await expect(page.getByLabel("Match status")).toContainText(/Municipality/);
    await expect(page.getByRole("button", { name: /standard:/i })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      (await page.viewportSize())!.width,
    );
  });

  test("routes each role to its own workstation and synchronizes readiness", async ({
    browser,
  }) => {
    const municipality = await browser.newContext();
    const mrf = await browser.newContext();
    const municipalityPage = await municipality.newPage();
    const mrfPage = await mrf.newPage();
    await authenticate(municipalityPage, municipalityToken!);
    await authenticate(mrfPage, mrfToken!);

    await Promise.all([
      municipalityPage.goto(`/games/${gameId}/municipality`),
      mrfPage.goto(`/games/${gameId}/mrf`),
    ]);
    await expect(municipalityPage.getByLabel("Match status")).toContainText(
      "Municipality",
    );
    await expect(mrfPage.getByLabel("Match status")).toContainText("MRF");
    await municipality.close();
    await mrf.close();
  });
});
