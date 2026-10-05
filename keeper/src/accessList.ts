import { getAddress, numberToHex, type AccessList, type Address, type Hex } from "viem";

/** MIP-8: storage is warmed in pages of 128 slots; page index = slot >> 7. */
export const PAGE_SHIFT = 7n;

export function pageOf(slot: bigint | Hex): bigint {
  return BigInt(slot) >> PAGE_SHIFT;
}

export function slotKey(slot: bigint): Hex {
  return numberToHex(slot, { size: 32 });
}

/**
 * Keeps one storage key per (address, page). Under MIP-8 an access-list key warms its whole page, so further
 * keys in the same page add intrinsic gas without warming anything new.
 */
export function compressToPages(list: AccessList): AccessList {
  const out = new Map<Address, Map<bigint, Hex>>();
  for (const entry of list) {
    const addr = getAddress(entry.address);
    const pages = out.get(addr) ?? new Map<bigint, Hex>();
    for (const key of entry.storageKeys) {
      const page = pageOf(key);
      if (!pages.has(page)) pages.set(page, slotKey(BigInt(key)));
    }
    out.set(addr, pages);
  }
  return [...out.entries()].map(([address, pages]) => ({ address, storageKeys: [...pages.values()] }));
}

/** Merges access lists, deduplicating addresses and keys. */
export function mergeAccessLists(...lists: AccessList[]): AccessList {
  const out = new Map<Address, Set<Hex>>();
  for (const list of lists) {
    for (const entry of list) {
      const addr = getAddress(entry.address);
      const keys = out.get(addr) ?? new Set<Hex>();
      for (const k of entry.storageKeys) keys.add(slotKey(BigInt(k)));
      out.set(addr, keys);
    }
  }
  return [...out.entries()].map(([address, keys]) => ({ address, storageKeys: [...keys] }));
}

/**
 * The pages Shield itself touches: the borrower's registry record and each collateral feed's volatility
 * window. Both base slots come from the contracts' own `recordSlot` and `volSlot` views.
 */
export function shieldAccessList(args: {
  registry: Address;
  recordSlots: bigint[];
  repricer: Address;
  volSlots: bigint[];
}): AccessList {
  return [
    { address: getAddress(args.registry), storageKeys: args.recordSlots.map(slotKey) },
    { address: getAddress(args.repricer), storageKeys: args.volSlots.map(slotKey) },
  ];
}

/** True when every expected page appears in the list for its address. */
export function coversPages(list: AccessList, address: Address, slots: bigint[]): boolean {
  const entry = list.find((e) => getAddress(e.address) === getAddress(address));
  if (!entry) return slots.length === 0;
  const pages = new Set(entry.storageKeys.map((k) => pageOf(k)));
  return slots.every((s) => pages.has(pageOf(s)));
}
