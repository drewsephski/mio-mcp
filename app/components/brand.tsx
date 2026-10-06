import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return <Link href={href} className="brand" aria-label="Mio home"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span><span>Mio</span></Link>;
}
