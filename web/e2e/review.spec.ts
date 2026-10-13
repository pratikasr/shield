import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { AAVE_ORACLE, WETH, borrower, client, connectTestWallet, ensureConnected, openNerds, oracleAbi, setWethPrice, statValue, usd } from "./helpers";

/**
 * Design review captures (docs/DESIGN.md, review log): every screen state at 375, 768 and 1440 px, light, plus dark
 * for the key screens. Runs only with REVIEW_DIR set, against the stack from scripts/stack.sh.
 *   REVIEW_DIR=../docs/screenshots/pass-1 pnpm exec playwright test review
 * REVIEW_WRONG=1 captures only the wrong-network state (needs a build with NEXT_PUBLIC_E2E_WRONG_CHAIN=1).
 */
const out = process.env.REVIEW_DIR;
const WIDTHS = [375, 768, 1440];

async function theme(page: Page, t: "dark" | "light") {
  await page.evaluate((name) => {
    localStorage.setItem("theme", name);
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(name);
  }, t);
}

async function shoot(page: Page, name: string, themes: ("dark" | "light")[] = ["light"], widths = WIDTHS) {
  // Version 3 has one light theme; a "dark" request captures nothing new, so it is skipped.
  for (const t of themes.filter((x) => x === "light")) {
    await theme(page, t);
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 900 });
      // A full-page shot draws sticky elements (header, side panel) where the current scroll puts them.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/${name}-${w}-${t}.png`, fullPage: true });
    }
  }
  await theme(page, "light");
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function afterExit(page: Page) {
  await page.goto("/app/borrow");
  await ensureConnected(page);
  await expect(page.getByText(/penalty avoided/).first()).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(2000);
  await shoot(page, "borrow-exited", ["light", "dark"]);

  await page.goto("/app/vault");
  await ensureConnected(page);
  await expect.poll(async () => statValue(page, "Rescues paid for"), { timeout: 90_000 }).toBe("1");
  await page.waitForTimeout(3000);
  await shoot(page, "vault-after-exit", ["dark", "light"]);

  await page.goto("/app/stats");
  await expect(page.getByRole("heading", { name: /^Stats/, level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => statValue(page, "Rescues"), { timeout: 90_000 }).toBe("1");
  await page.waitForTimeout(3000);
  await shoot(page, "stats");
}

test.describe("design review captures", () => {
  test.skip(!out, "set REVIEW_DIR to capture");
  test.beforeAll(() => mkdirSync(out!, { recursive: true }));

  test("wrong network", async ({ page }) => {
    test.skip(process.env.REVIEW_WRONG !== "1", "needs NEXT_PUBLIC_E2E_WRONG_CHAIN=1");
    await page.goto("/app/borrow");
    await page.waitForTimeout(2500);
    await connectTestWallet(page);
    await expect(page.getByRole("alert").first()).toBeVisible({ timeout: 30_000 });
    await shoot(page, "borrow-wrong-network");
  });

  test("every state of the main flow", async ({ page }) => {
    test.skip(process.env.REVIEW_WRONG === "1" || process.env.REVIEW_AFTER === "1", "other run mode");
    test.setTimeout(900_000);

    await page.goto("/");
    await expect(page.getByText(/Monad block [\d,]+/)).toBeVisible({ timeout: 30_000 });
    await shoot(page, "landing", ["dark", "light"]);

    await page.goto("/app/borrow");
    await expect(page.getByRole("heading", { level: 1, name: /Is your Aave loan safe/ })).toBeVisible();
    await shoot(page, "borrow-disconnected");

    await page.goto(`/app/borrow?address=${borrower}`);
    await expect(page.getByText(/read only/).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 60_000 });
    await shoot(page, "borrow-watching");

    await page.goto("/app/borrow");
    await page.waitForTimeout(2500);
    await connectTestWallet(page);
    await expect(page.getByRole("heading", { level: 1, name: /^ETH can fall/ })).toBeVisible({ timeout: 90_000 });
    await shoot(page, "borrow-setup");

    // A line close to Aave's 1.00 asks for an acknowledgement before turning on.
    const last = page.getByRole("radio", { name: /^Last call/ });
    if (await last.isEnabled().catch(() => false)) {
      await last.click();
      if (await page.getByText(/I understand a line this close/).isVisible().catch(() => false)) {
        await shoot(page, "borrow-setup-near-one", ["light"], [375, 1440]);
      }
    }
    await page.getByRole("radio", { name: /^Early/ }).click();
    await page.getByRole("button", { name: "Turn on Shield" }).first().click();
    // The cover arms after the waiting period (20 s on the fork stack): capture the countdown if it is still running,
    // then the armed state.
    const arming = page.getByRole("heading", { level: 1, name: /^Shield is arming/ });
    if (await arming.waitFor({ timeout: 120_000 }).then(() => true, () => false)) await shoot(page, "borrow-arming", ["light"], [375, 1440]);
    await expect(page.getByRole("heading", { level: 1, name: /^Shield is on/ })).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(
        async () => {
          await openNerds(page);
          return usd(await statValue(page, "Premium paid so far"));
        },
        { timeout: 90_000 },
      )
      .toBeGreaterThan(0);
    await page.reload();
    await ensureConnected(page);
    await expect(page.getByRole("heading", { level: 1, name: /^Shield is on/ })).toBeVisible({ timeout: 90_000 });
    await shoot(page, "borrow-protected");

    await page.goto("/app/vault");
    await ensureConnected(page);
    await expect(page.locator("dt", { hasText: "In the vault" }).first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(3000);
    await shoot(page, "vault-before-exit", ["dark", "light"]);

    const price = await client.readContract({ address: AAVE_ORACLE, abi: oracleAbi, functionName: "getAssetPrice", args: [WETH] });
    await setWethPrice((price * 984n) / 1000n);
    await afterExit(page);
  });

  test("after the exit", async ({ page }) => {
    test.skip(process.env.REVIEW_AFTER !== "1", "set REVIEW_AFTER=1 once the position has exited");
    test.setTimeout(600_000);
    await afterExit(page);
  });
});
