"use client";
import Link from "next/link";
import { LockKeyhole, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./design-system";
import { ApiClientError } from "@/components/api-client";
export function AccessDenied({ audited = false }: {
    audited?: boolean;
}) { return <EmptyState title="Access denied" description={audited ? "This attempt has been recorded. Ask your case administrator to review your assignment." : "This view is not available to your role. Use the permitted sections in your navigation, or ask your administrator to review your assignment."} icon={<LockKeyhole className="size-6 text-tampered"/>} action={<Button variant="outline" asChild><Link href="/login">Return to sign in</Link></Button>}/>; }
export function ResourceError({ error, retry }: {
    error: Error;
    retry: () => void;
}) {
    const status = error instanceof ApiClientError ? error.status : 0;
    if (status === 403)
        return <AccessDenied audited/>;
    return <EmptyState title={status === 401 ? "Your session has ended" : status === 404 ? "Record unavailable" : "We couldn’t load this view"} description={status === 404 ? "Check the link or return to your permitted workspace. No evidence metadata is disclosed." : status === 503 ? "This service is temporarily unavailable. No verification result has been changed; retry when the service is ready." : "No verification result has been changed. Try again, or sign in to renew your session."} icon={<AlertTriangle className="size-6 text-tampered"/>} action={<div className="flex gap-2"><Button onClick={retry}>Try again</Button><Button variant="outline" asChild><Link href="/login">Sign in</Link></Button></div>}/>;
}
