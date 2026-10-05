/**
 * Set while a wallet is connected, so the server can render a reconnect skeleton for a returning wallet and the
 * connect prompt for everyone else. It holds no address or other data.
 */
export const WALLET_COOKIE = "shield_wallet";

export function setWalletCookie(connected: boolean) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = connected
    ? `${WALLET_COOKIE}=1; path=/; max-age=31536000; samesite=lax${secure}`
    : `${WALLET_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
}
