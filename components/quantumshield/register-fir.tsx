"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { CaseDetail, CreateCaseRequest } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useSession } from "./session";
import { FirNumber } from "./fir-number";

export function RegisterFir({onCreated}:{onCreated:(record:CaseDetail)=>void}) {
 const session=useSession();
 const [open,setOpen]=useState(false);
 const [email,setEmail]=useState("");
 const [place,setPlace]=useState("");
 const [occurredAt,setOccurredAt]=useState("");
 const [facts,setFacts]=useState("");
 const [firText,setFirText]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [created,setCreated]=useState<CaseDetail|null>(null);
 const [copied,setCopied]=useState(false);
 async function submit(event:FormEvent) {
  event.preventDefault();
  if(busy||created)return;
  const text=["Place: "+place.trim(),"Date and time (IST): "+occurredAt.replace("T"," "),"Brief facts: "+facts.trim(),"",firText.trim()].join(String.fromCharCode(10));
  if(!firText.trim()){setError("Write the FIR before submitting.");return;}
  if(text.length>20000){setError("The FIR, including place, date and brief facts, must be within 20,000 characters.");return;}
  const body:CreateCaseRequest={firText:text,...(email.trim()?{complainantEmail:email.trim()}:{})};
  setBusy(true);setError("");
  try {const record=await api("POST /api/cases",{body});setCreated(record);onCreated(record);}
  catch(reason){setError(reason instanceof Error?reason.message:"FIR registration failed. Please retry.");}
  finally{setBusy(false);}
 }
 function changeOpen(next:boolean){if(busy)return;if(next){setCreated(null);setCopied(false);setError("");setEmail("");setPlace("");setOccurredAt("");setFacts("");setFirText("");}setOpen(next);}
 async function copy(){if(!created)return;try{await navigator.clipboard.writeText(created.firNo);setCopied(true);}catch{setError("Could not copy. Select the FIR number and copy it.");}}
 return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button>Register FIR</Button></DialogTrigger><DialogContent className="sm:!max-w-2xl" showCloseButton={!busy}><DialogHeader><DialogTitle>{created?"FIR registered":"Register FIR"}</DialogTitle><DialogDescription>{created?"Keep this number for all case correspondence.":"Write the complaint below. The register assigns the FIR number."}</DialogDescription></DialogHeader>{created?<div className="space-y-4" role="status"><p className="text-sm text-muted-foreground">Assigned FIR No.</p><div className="flex flex-wrap items-center gap-3 text-2xl"><FirNumber value={created.firNo}/><Button variant="outline" onClick={()=>void copy()} aria-label="Copy assigned FIR number">{copied?"Copied":"Copy"}</Button></div><p>{created.station}</p><p className="text-sm text-muted-foreground">The FIR is saved as the first encrypted exhibit in this case.</p>{error&&<p role="alert" className="text-tampered">{error}</p>}<DialogFooter><Button asChild><Link href={"/cases/"+created.id}>Open case</Link></Button><Button variant="outline" onClick={()=>changeOpen(false)}>Close</Button></DialogFooter></div>:<form onSubmit={submit} className="space-y-4"><p className="text-sm"><span className="text-muted-foreground">Police Station: </span>{session.user.station}</p><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor="fir-place">Place of occurrence</Label><Input id="fir-place" required maxLength={200} value={place} onChange={e=>setPlace(e.target.value)}/></div><div className="space-y-1"><Label htmlFor="fir-date">Date and time of occurrence (IST)</Label><Input id="fir-date" type="datetime-local" required value={occurredAt} onChange={e=>setOccurredAt(e.target.value)}/></div></div><div className="space-y-1"><Label htmlFor="fir-email">Complainant email (optional)</Label><Input id="fir-email" type="email" value={email} onChange={e=>setEmail(e.target.value)}/></div><div className="space-y-1"><Label htmlFor="fir-facts">Brief facts</Label><Input id="fir-facts" required maxLength={500} value={facts} onChange={e=>setFacts(e.target.value)}/></div><div className="space-y-1"><Label htmlFor="fir-text">FIR text</Label><Textarea id="fir-text" required rows={10} maxLength={19000} className="min-h-64 text-base" value={firText} onChange={e=>setFirText(e.target.value)} aria-describedby="fir-text-help"/><p id="fir-text-help" className="text-xs text-muted-foreground">Record the complaint in full. Corrections require a new version.</p></div>{error&&<p role="alert" className="text-sm text-tampered">{error}</p>}<DialogFooter><Button variant="outline" type="button" disabled={busy} onClick={()=>changeOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy?"Registering FIR…":"Register FIR"}</Button></DialogFooter></form>}</DialogContent></Dialog>;
}
