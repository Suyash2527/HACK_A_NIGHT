import { CloudOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
export function Unavailable({ feature, detail }: {
    feature: string;
    detail: string;
}) {
    return <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center px-4"><Alert className="border-pending/30 bg-pending-surface/50"><CloudOff className="text-pending"/><AlertTitle>{feature} is unavailable</AlertTitle><AlertDescription>{detail}<span className="mt-3 block font-mono text-xs text-pending">503 · FEATURE_DISABLED</span></AlertDescription></Alert></div>;
}
