"use client"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"
import { Menu } from "lucide-react"
import { toast } from "sonner"
import type { Role } from "@/types/api"
import { apiFetch, ApiClientError, USE_MOCKS } from "@/components/api-client"
import { currentMockSession, MOCK_CASE, MOCK_GRANTED_DOCUMENT } from "./mocks"
import { Brand } from "./brand"
import { SessionContext } from "./session"
import { useResource } from "./use-resource"
import { AccessDenied, ResourceError } from "./access-state"
import { PageSkeleton } from "./design-system"
import { roleLabel } from "./format"
import { TrustStrip } from "./trust-strip"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet"
const progressPath="/cases/"+MOCK_CASE.id+"/progress"
const grantedPath="/documents/"+MOCK_GRANTED_DOCUMENT.id
export function roleHome(role:Role) {return role==="COMPLAINANT"?(USE_MOCKS?progressPath:"/dashboard"):role==="DEFENCE_ADVOCATE"?"/requests":"/dashboard"}
function linksFor(role:Role) {
 if(role==="COMPLAINANT") return [{href:USE_MOCKS?progressPath:"/dashboard",label:"My case progress"}]
 if(role==="DEFENCE_ADVOCATE") return [{href:"/requests",label:"Document requests"},...(USE_MOCKS?[{href:grantedPath,label:"Granted documents"}]:[])]
 const items=[{href:"/dashboard",label:"Home"},{href:"/cases",label:role==="POLICE"?"My cases":role==="FORENSIC_LAB"?"Assigned cases":"Cases"}]
 if(role==="JUDGE") items.push({href:"/requests",label:"Requests queue"})
 if(["JUDGE","ADMIN","PUBLIC_PROSECUTOR"].includes(role)) items.push({href:"/integrity",label:"Integrity"},{href:"/audit",label:"Audit chain"},{href:"/batches",label:"Batches"})
 return items
}
export function AppShell({children}:{children:ReactNode}) {
 const session=useResource("GET /api/auth/session",{mock:currentMockSession()});const pathname=usePathname();const router=useRouter();const [mobile,setMobile]=useState(false)
 useEffect(()=>{if(session.error instanceof ApiClientError&&session.error.status===401)router.replace("/login")},[session.error,router])
 if(session.loading) return <main className="p-4"><PageSkeleton/></main>
 if(session.error||!session.data) return <ResourceError error={session.error||new Error("No session")} retry={session.reload}/>
 const user=session.data.user;const links=linksFor(user.role);const home=roleHome(user.role)
 const restricted=user.role==="COMPLAINANT"?!((pathname.startsWith("/cases/")&&pathname.endsWith("/progress"))||pathname==="/dashboard"):user.role==="DEFENCE_ADVOCATE"?!(pathname==="/requests"||pathname.startsWith("/documents/")):false
 const navigation=<nav aria-label="Primary">{links.map(({href,label})=>{const active=pathname===href||(href==="/cases"&&pathname.startsWith("/cases/"));return <Link key={href} href={href} aria-current={active?"page":undefined} onClick={()=>setMobile(false)} className="nav-link">{label}</Link>})}</nav>
 return <SessionContext.Provider value={session.data}><div className="min-h-dvh"><a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-card focus:p-3">Skip to content</a><header data-app-header className="sticky top-0 z-30 flex min-h-12 flex-wrap items-center gap-3 border-b bg-background px-3 py-2"><Sheet open={mobile} onOpenChange={setMobile}><SheetTrigger asChild><Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open navigation"><Menu/></Button></SheetTrigger><SheetContent side="left" className="w-64 p-4"><SheetHeader className="sr-only"><SheetTitle>Sakshya navigation</SheetTitle><SheetDescription>Permitted sections</SheetDescription></SheetHeader><Brand href={home}/><div className="mt-5">{navigation}</div></SheetContent></Sheet><Brand href={home}/><div className="ml-auto flex items-center gap-3 text-xs"><span>{user.name}<span className="block text-muted-foreground sm:inline"> · {roleLabel(user.role)}</span></span><span className="hidden text-muted-foreground xl:block">{user.station}</span><Button variant="outline" size="sm" onClick={async()=>{try{await apiFetch("POST /api/auth/logout",{mock:{ok:true}});router.push("/login")}catch{toast.error("Sign out failed. Retry.")}}}>Logout</Button></div><span className="w-full text-xs text-muted-foreground sm:hidden">Station: {user.station}</span></header><aside className="fixed bottom-0 left-0 top-12 hidden w-44 border-r bg-background pt-5 lg:block">{navigation}</aside><div className="app-body min-w-0 lg:pl-44">{USE_MOCKS&&<div role="status" className="border-b px-4 py-1 text-xs text-pending">Demo data — simulated results</div>}<main id="main-content" className="min-h-[75vh] min-w-0 p-3 sm:p-5">{restricted?<AccessDenied/>:children}</main><TrustStrip/></div></div></SessionContext.Provider>
}
