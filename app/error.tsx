"use client";
import { ResourceError } from "@/components/quantumshield/access-state";
export default function ErrorPage({ error, retry }: {
    error: Error & {
        digest?: string;
    };
    retry: () => void;
}) { return <main className="mx-auto max-w-3xl p-6"><ResourceError error={error} retry={retry}/></main>; }
