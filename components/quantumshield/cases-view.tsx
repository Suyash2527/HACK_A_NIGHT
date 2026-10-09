"use client"
import Link from "next/link"
import { useState } from "react"
import { FolderOpen, Plus, ArrowRight, Copy } from "lucide-react"
import { toast } from "sonner"
import type { CaseDetail, CaseSummary, VerifyStatus, CreateCaseRequest } from "@/types/api"
import { apiFetch, USE_MOCKS } from "@/components/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter,DialogTrigger } from "@/components/ui/dialog"
import { MOCK_CASES,mockRegisterCase,rememberMockCase } from "./mocks"
import { useSession } from "./session"
import { useResource } from "./use-resource"
import { ResourceError } from "./access-state"
import { PageHeader } from "./page-header"
import { SectionCard,DataTable,PageSkeleton,RelativeTime,EmptyState,humanize } from "./design-system"
import { FirNumber } from "./fir-number"
import { FirCheckBox } from "./fir-check"
import { StatusBadge } from "./status-badge"
function caseStatus(c:CaseSummary):VerifyStatus|null { const x=c.integrity;return x.TAMPERED?"TAMPERED":x.ERROR?"ERROR":x.PENDING_ANCHOR?"PENDING_ANCHOR":x.UNANCHORED?"UNANCHORED":c.documentCount>0&&x.VERIFIED===c.documentCount?"VERIFIED":null }
export function CasesView(){const session=useSession();const resource=useResource("GET /api/cases",{mock:MOCK_CASES});const [filter,setFilter]=useState("All cases");
 if(resource.loading)return <PageSkeleton/>;if(resource.error||!resource.data)return <ResourceError error={resource.error||new Error("No cases")} retry={resource.reload}/>
 const rows=resource.data.items.filter(c=>filter==="All cases"||filter==="Needs attention"&&c.integrity.TAMPERED>0||filter==="Open"&&c.status==="OPEN")
 return <div className="page-grid"><PageHeader eyebrow="Workspace / cases" title="Case register" description="Every case, its evidence and the people accountable for it." action={session.canCreateCase&&<CreateCase onCreated={c=>resource.setData(current=>current?{...current,items:[c,...current.items.filter(item=>item.id!==c.id)]}:{items:[c],nextCursor:null})}/>}/><div className="no-print flex flex-wrap gap-2" aria-label="Filter cases">{["All cases","Needs attention","Open"].map(f=><Button key={f} variant={f===filter?"secondary":"ghost"} size="sm" aria-pressed={f===filter} onClick={()=>setFilter(f)}>{f}</Button>)}</div><SectionCard>{resource.data.items.length?<DataTable rows={rows} rowKey={c=>c.id} searchText={c=>c.firNo+" "+c.station} searchLabel="Search FIR or police station" columns={[
 {key:"case",label:"Case reference",sort:c=>c.firNo,render:c=><Link href={"/cases/"+c.id} className="flex items-center gap-3 font-semibold text-primary"><span className="rounded-lg bg-accent p-2"><FolderOpen className="size-4"/></span><FirNumber value={c.firNo}/></Link>},
 {key:"station",label:"Station & stage",sort:c=>c.station,render:c=><div><p>{c.station}</p><p className="text-xs text-muted-foreground">{humanize(c.stage)}</p></div>},
 {key:"files",label:"Evidence",sort:c=>c.documentCount,render:c=><span>{c.documentCount} files</span>},
 {key:"status",label:"Integrity",render:c=><StatusBadge status={caseStatus(c)}/>},
 {key:"created",label:"Opened",sort:c=>c.createdAt,render:c=><RelativeTime at={c.createdAt}/>},
 {key:"open",label:"",render:c=><Button asChild variant="ghost" size="icon-sm"><Link href={"/cases/"+c.id} aria-label={"Open case "+c.firNo}><ArrowRight/></Link></Button>}
 ]}/>:<EmptyState title="Your case register is ready" description={session.canCreateCase?"Register a case to begin a traceable evidence record.":"Ask your case administrator to assign your first case."}/>}</SectionCard><FirCheckBox/></div>
}
export function CreateCase({onCreated}:{onCreated:(c:CaseDetail)=>void}) {
 const session=useSession()
 const [open,setOpen]=useState(false),[email,setEmail]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[created,setCreated]=useState<CaseDetail|null>(null)
 async function submit(event:React.FormEvent){event.preventDefault();if(busy||created)return;setBusy(true);setError("");const body:CreateCaseRequest=email.trim()?{complainantEmail:email.trim()}:{};try{const c=await apiFetch("POST /api/cases",{body,mock:USE_MOCKS?mockRegisterCase(session):undefined});if(USE_MOCKS)rememberMockCase(c);setCreated(c);toast.success("Case registered",{description:c.firNo})}catch(e){setError(e instanceof Error?e.message:"Could not register case");toast.error("Case registration failed")}finally{setBusy(false)}}
 function changeOpen(next:boolean){if(busy)return;if(!next&&created)onCreated(created);if(next){setCreated(null);setEmail("");setError("")}setOpen(next)}
 async function copy(){if(!created)return;try{await navigator.clipboard.writeText(created.firNo);toast.success("FIR number copied")}catch{toast.error("Could not copy. Select the assigned number to copy it manually.")}}
 return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button><Plus/>Register case</Button></DialogTrigger><DialogContent showCloseButton={!busy}><DialogHeader><DialogTitle>{created?"Case registered":"Register case"}</DialogTitle><DialogDescription>{created?"Keep this assigned FIR number for future reference.":"Sakshya assigns the FIR number. Your station comes from your signed-in account; neither can be entered or edited here."}</DialogDescription></DialogHeader>{created?<div className="space-y-4" role="status"><div className="rounded-lg border bg-muted/40 p-4"><p className="section-label mb-2">Assigned FIR number</p><div className="flex flex-wrap items-center gap-2"><FirNumber value={created.firNo}/><Button variant="ghost" size="icon-sm" aria-label="Copy assigned FIR number" onClick={()=>void copy()}><Copy/></Button></div><p className="mt-3 text-xs text-muted-foreground">Assigned by Sakshya · verification code {created.firNo.split("/").at(-1)}</p><p className="mt-2 text-sm">{created.station}</p></div>{USE_MOCKS&&<p className="text-xs text-muted-foreground">Demo assignment only. No live FIR register was changed.</p>}<DialogFooter><Button onClick={()=>changeOpen(false)}>Done</Button><Button asChild variant="outline"><Link href={"/cases/"+created.id} onClick={()=>changeOpen(false)}>Open case<ArrowRight/></Link></Button></DialogFooter></div>:<form className="space-y-4" onSubmit={submit}><div className="rounded-lg bg-muted/40 p-3 text-sm"><p className="section-label">Registering station</p>{session.user.station}</div><div className="space-y-2"><Label htmlFor="complainant-email">Complainant email (optional)</Label><Input id="complainant-email" type="email" autoComplete="email" value={email} disabled={busy} onChange={e=>setEmail(e.target.value)}/></div>{error&&<p role="alert" className="text-sm text-tampered">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={()=>changeOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy?"Registering…":"Register case"}</Button></DialogFooter></form>}</DialogContent></Dialog>
}
