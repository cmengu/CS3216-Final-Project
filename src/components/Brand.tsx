import Image from "next/image";
import Link from "next/link";

/** Shared home link keeps the supplied wordmark consistent across public and workspace pages. */
export function Brand() {
  return (
    <Link className="ic-brand ic-brand--logo" href="/" aria-label="Linecheck home">
      <Image src="/brand/linecheck-logo.png" alt="Linecheck" width={1138} height={210} className="ic-brand-logo" preload />
    </Link>
  );
}
