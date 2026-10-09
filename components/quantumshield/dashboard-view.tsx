"use client"
import { BlockchainActivity } from "./blockchain-activity"
import Link from "next/link"
import type { CaseSummary } from "@/types/api"
import { Button } from "@/components/ui/button"
import { MOCK_CASES, MOCK_AUDIT } from "./mocks"
import { useSession } from "./session"
import { useResource } from "./use-resource"
import { ResourceError } from "./access-state"
import { PageHeader } from "./page-header"
import { DataTable, PageSkeleton, SectionCard, StatCard, RelativeTime, humanize } from "./design-system"
import { UploadDialog } from "./upload-dialog"
import { CreateCase } from "./cases-view"
import { FirNumber } from "./fir-number"
import { StatusBadge } from "./status-badge"
import { FirCheckBox } from "./fir-check"
export function DashboardView() {
 const session=useSession();const cases=useResource("GET /api/cases",{query:{limit:100},mock:MOCK_CASES})
 if(cases.loading)return <PageSkeleton/>;if(cases.error||!cases.data)return <ResourceError error={cases.error||new Error("No cases")} retry={cases.reload}/>
 const rows=cases.data.items;const role=session.user.role;const court=["JUDGE","PUBLIC_PROSECUTOR","ADMIN"].includes(role)
 if(role==="COMPLAINANT")return <div className="page-grid"><PageHeader title="My case progress" description="Recorded milestones for your case."/><SectionCard>{rows.map(c=><Link key={c.id} className="block py-2 text-[#ff9933]" href={"/cases/"+c.id+"/progress"}><FirNumber value={c.firNo}/> · View progress</Link>)}{!rows.length&&<p className="text-sm text-muted-foreground">No case linked to this account. Contact the station.</p>}</SectionCard></div>
 const total=rows.reduce((n,c)=>n+c.documentCount,0);const verified=rows.reduce((n,c)=>n+c.integrity.VERIFIED,0);const attention=rows.filter(c=>c.integrity.TAMPERED||c.integrity.ERROR||c.integrity.unchecked)
 const title=role==="POLICE"?"My cases":role==="FORENSIC_LAB"?"Assigned cases":role==="ADMIN"?"Administration":"Court cases"
 const caseColumns=[{key:"fir",label:"FIR No.",sort:(c:CaseSummary)=>c.firNo,render:(c:CaseSummary)=><Link className="text-[#ff9933]" href={"/cases/"+c.id}><FirNumber value={c.firNo}/></Link>},{key:"station",label:"Station",render:(c:CaseSummary)=>c.station},{key:"stage",label:"Stage",render:(c:CaseSummary)=>humanize(c.stage)}]
 return <div className="page-grid"><PageHeader title={title} description={session.user.station} action={<>{session.canCreateCase&&<CreateCase onCreated={()=>cases.reload()}/>} {role==="FORENSIC_LAB"&&rows.length>0&&<UploadDialog caseId={rows[0].id} allowedTypes={session.allowedUploadTypes} onComplete={cases.reload}/>}</>}/>{court&&<div className="flex flex-wrap gap-2">{role==="JUDGE"&&<Button asChild variant="outline"><Link href="/requests">Requests queue</Link></Button>}<Button asChild variant="outline"><Link href="/integrity">Integrity scans</Link></Button><Button asChild variant="outline"><Link href="/audit">Audit chain / FIR register</Link></Button><Button asChild variant="outline"><Link href="/batches">Batches</Link></Button></div>}<div className="grid grid-cols-2 gap-2 lg:grid-cols-4"><StatCard label="Cases" value={rows.length} detail="Permitted cases"/><StatCard label="Documents" value={total} detail="Includes retained versions"/><StatCard label="Verified" value={verified} detail="Recorded VERIFIED results"/><StatCard label="Needs attention" value={attention.length} detail="Changed, failed or unchecked" danger={attention.length>0}/></div><div className="grid min-w-0 gap-4 xl:grid-cols-2"><SectionCard title="Needs attention"><DataTable rows={attention.slice(0,5)} rowKey={c=>c.id} searchText={c=>c.firNo+" "+c.station} columns={[...caseColumns.slice(0,1),{key:"status",label:"Integrity",render:c=><StatusBadge status={c.integrity.TAMPERED?"TAMPERED":c.integrity.ERROR?"ERROR":null}/>}]} /></SectionCard>{["JUDGE","ADMIN"].includes(role)?<RecentActivity/>:<SectionCard title="Recent activity"><DataTable rows={[...rows].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,5)} rowKey={c=>c.id} searchText={c=>c.firNo} columns={[...caseColumns.slice(0,1),{key:"filed",label:"Filed on",render:c=><RelativeTime at={c.createdAt}/>}]} /></SectionCard>}</div><SectionCard title={title} action={<Button asChild variant="link"><Link href="/cases">Open register</Link></Button>}><DataTable rows={rows.slice(0,5)} rowKey={c=>c.id} searchText={c=>c.firNo+" "+c.station} columns={caseColumns}/></SectionCard>{court&&<BlockchainActivity/>}{role==="ADMIN"&&<FirCheckBox/>}</div>
}
function RecentActivity(){const events=useResource("GET /api/audit",{query:{limit:5},mock:MOCK_AUDIT});return <SectionCard title="Recent activity">{events.loading?<PageSkeleton/>:events.error?<ResourceError error={events.error} retry={events.reload}/>:<DataTable rows={events.data?.items??[]} rowKey={e=>e.id} searchText={e=>e.actorName+e.action} columns={[{key:"action",label:"Action",render:e=><span className={e.action==="DENIED"||e.action==="TAMPER_DETECTED"?"text-tampered":""}>{humanize(e.action)}</span>},{key:"actor",label:"Actor",render:e=>e.actorName},{key:"at",label:"Recorded on",render:e=><RelativeTime at={e.at}/>}]} />}</SectionCard>}
