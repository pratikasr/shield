// Screenshots of the app routes with the fork test wallet connected (fork builds only).
// Usage: node scripts/shots-app.mjs <baseUrl> <outDir> [widths...]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:3100", out = "../docs/screenshots", ...ws] = process.argv.slice(2);
const widths = ws.length ? ws.map(Number) : [375, 768, 1440];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
    const page = await ctx.newPage();
    for (const route of ["/app/borrow", "/app/vault"]) {
      await page.goto(base + route, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const connect = page.getByRole("button", { name: /^connect/i }).first();
      if (await connect.isVisible().catch(() => false)) {
        await connect.click();
        await page.getByText("Fork test wallet", { exact: true }).click({ timeout: 10_000 });
      }
      await page.waitForTimeout(Number(process.env.SHOT_WAIT ?? 12000));
      const name = `${route.split("/").pop()}-connected-${w}-${theme}.png`;
      await page.screenshot({ path: `${out}/${name}`, fullPage: true });
      console.log(name);
    }
    await ctx.close();
  }
}
await browser.close();
