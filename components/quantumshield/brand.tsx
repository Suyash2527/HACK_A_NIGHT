import Link from "next/link"
export function Brand({ href = "/dashboard" }: { href?: string }) { return <Link href={href} aria-label="Sakshya home" className="shrink-0 text-base font-semibold">Sakshya</Link> }
