import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { isEntryPoint } from "../src/index.js";
import { LockHeldError, acquireLock, defaultLockPath } from "../src/lock.js";
import { verifyDeployment } from "../src/startup.js";

const REGISTRY = "0x1111111111111111111111111111111111111111" as Address;
const REPRICER = "0x2222222222222222222222222222222222222222" as Address;
const EXECUTOR = "0x3333333333333333333333333333333333333333" as Address;
const OTHER = "0x4444444444444444444444444444444444444444" as Address;
const FACTORY = "0x5555555555555555555555555555555555555555" as Address;

function chain(opts: { code?: Record<string, string>; links?: Partial<Record<string, Address>> } = {}) {
  const links: Record<string, Address> = {
    "executor.registry": REGISTRY,
    "repricer.registry": REGISTRY,
    "executor.repricer": REPRICER,
    "factory.repricer": REPRICER,
    "factory.registry": REGISTRY,
    ...opts.links,
  };
  return {
    async getCode({ address }: { address: Address }) {
      return opts.code?.[address] ?? "0x6080";
    },
    async readContract({ address, functionName }: { address: Address; functionName: string }) {
      const who = address === EXECUTOR ? "executor" : address === FACTORY ? "factory" : "repricer";
      return links[`${who}.${functionName}`];
    },
  };
}

const cfg = { registry: REGISTRY, repricer: REPRICER, executor: EXECUTOR };

describe("startup checks (audit M8)", () => {
  it("accepts a wired deployment", async () => {
    await expect(verifyDeployment(chain() as never, cfg)).resolves.toBeUndefined();
  });

  it("refuses an address without code", async () => {
    await expect(verifyDeployment(chain({ code: { [REPRICER]: "0x" } }) as never, cfg)).rejects.toThrow(/no contract code at the Repricer/);
  });

  it("refuses contracts wired to another registry or Repricer", async () => {
    await expect(verifyDeployment(chain({ links: { "executor.registry": OTHER } }) as never, cfg)).rejects.toThrow(
      /Executor .* uses registry/,
    );
    await expect(verifyDeployment(chain({ links: { "repricer.registry": OTHER } }) as never, cfg)).rejects.toThrow(
      /Repricer .* uses registry/,
    );
    await expect(verifyDeployment(chain({ links: { "executor.repricer": OTHER } }) as never, cfg)).rejects.toThrow(
      /uses Repricer/,
    );
  });

  it("checks a configured forwarder factory: code, and the same Repricer and registry", async () => {
    const withFactory = { ...cfg, forwarders: FACTORY };
    await expect(verifyDeployment(chain() as never, withFactory)).resolves.toBeUndefined();
    await expect(verifyDeployment(chain({ code: { [FACTORY]: "0x" } }) as never, withFactory)).rejects.toThrow(
      /no contract code at the ShieldForwarderFactory/,
    );
    await expect(verifyDeployment(chain({ links: { "factory.repricer": OTHER } }) as never, withFactory)).rejects.toThrow(
      /ShieldForwarderFactory .* uses Repricer/,
    );
    await expect(verifyDeployment(chain({ links: { "factory.registry": OTHER } }) as never, withFactory)).rejects.toThrow(
      /ShieldForwarderFactory .* uses registry/,
    );
  });
});

describe("single-instance lock", () => {
  it("refuses a second keeper while the first is alive, and takes over a stale lock", () => {
    const dir = mkdtempSync(join(tmpdir(), "shield-lock-"));
    const path = join(dir, "keeper.lock");
    const first = acquireLock(path, process.pid);
    expect(readFileSync(path, "utf8").trim()).toBe(String(process.pid));
    expect(() => acquireLock(path, process.pid + 1_000_000)).toThrow(LockHeldError);
    first.release();
    expect(existsSync(path)).toBe(false);
    writeFileSync(path, "999999999\n"); // a pid that is not running
    const second = acquireLock(path, process.pid);
    expect(readFileSync(path, "utf8").trim()).toBe(String(process.pid));
    second.release();
  });

  it("locks per chain and keeper account by default", () => {
    expect(defaultLockPath(143, "0xAbC0000000000000000000000000000000000001")).toMatch(
      /keeper[\\/]\.keeper-143-0xabc0000000000000000000000000000000000001\.lock$/,
    );
  });
});

describe("entry point", () => {
  it("recognises the module as the entry point even when the path has spaces", () => {
    const file = "/tmp/my keeper/src/index.ts";
    expect(isEntryPoint(pathToFileURL(file).href, file)).toBe(true);
    expect(`file://${file}` === pathToFileURL(file).href).toBe(false); // the old check missed this
    expect(isEntryPoint(pathToFileURL(file).href, undefined)).toBe(false);
  });
});
