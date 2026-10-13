import Link from "next/link";
import { LiveBlockChip } from "@/components/cartoon/block-ticker";
import { HeaderBar } from "./header-bar";

/** The landing page's top bar: no wallet stack loads here, so it offers the app instead of a wallet button. */
export function SiteHeader() {
  return (
    <HeaderBar
      end={
        <>
          <LiveBlockChip />
          <Link href="/app/borrow" className="c-wallet" data-tone="connect">
            Open app
          </Link>
        </>
      }
    />
  );
}
