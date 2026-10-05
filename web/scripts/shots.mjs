// Screenshots of every route at 375, 768 and 1440 px, dark and light, for the design review (docs/screenshots).
// Usage: node scripts/shots.mjs <baseUrl> <outDir> [route ...]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:3100", out = "../docs/screenshots", ...routes] = process.argv.slice(2);
const paths = routes.length ? routes : ["/", "/app/borrow", "/app/vault"];
const widths = [375, 768, 1440];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
    const page = await ctx.newPage();
    for (const p of paths) {
      await page.goto(base + p, { waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(2500);
      const name = `${p === "/" ? "landing" : p.replace(/^\/app\//, "").replace(/\//g, "-")}-${w}-${theme}.png`;
      await page.screenshot({ path: `${out}/${name}`, fullPage: true });
      console.log(name);
    }
    await ctx.close();
  }
}
await browser.close();
