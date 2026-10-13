
/**
 * Testnet builds only (NEXT_PUBLIC_CHAIN_ID=10143, ADR-040): says plainly which market the app is on. Aave V3 is not on
 * Monad testnet, so Shield staged there on an Aave V3 market it deployed from Aave's own code, with test tokens.
 */
export function TestnetStrip() {
  if (process.env.NEXT_PUBLIC_CHAIN_ID !== "10143") return null;
  return (
    <div className="border-b-[2.5px] border-ink bg-heads-tint">
      <p className="c-wrap m-0 py-2.5 text-[14.5px] font-semibold">
        Monad testnet. Aave isn&rsquo;t on testnet, so Shield runs here on an Aave V3 market we deployed from Aave&rsquo;s own code, with test WETH and USDC
        that are worth nothing.
      </p>
    </div>
  );
}
