"use client";
import { useEffect, useState } from "react";
import type { ApiRoute, ApiRoutes, Page } from "@/types/api";
import { apiFetch, USE_MOCKS, type ApiRequest } from "@/components/api-client";
const paginated = new Set<ApiRoute>(["GET /api/cases", "GET /api/documents", "GET /api/audit", "GET /api/batches"]);
export function useResource<R extends ApiRoute>(route: R, request: ApiRequest<R>) {
    const [data, setData] = useState<ApiRoutes[R]["res"] | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [loading, setLoading] = useState(true);
    const [revision, setRevision] = useState(0);
    const encoded = JSON.stringify(request);
    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        const parsed = JSON.parse(encoded) as ApiRequest<R>;
        async function load() {
            if (active) {
                setLoading(true);
                setError(null);
            }
            try {
                let value = await apiFetch(route, { ...parsed, signal: controller.signal });
                if (paginated.has(route) && !USE_MOCKS) {
                    const page = value as Page<unknown>;
                    const items = [...page.items];
                    let cursor = page.nextCursor;
                    const seen = new Set<string>();
                    while (cursor) {
                        if (seen.has(cursor))
                            throw new Error("Pagination cursor repeated. Retry the register.");
                        seen.add(cursor);
                        const next = await apiFetch(route, { ...parsed, query: { ...(parsed.query as Record<string, unknown>), cursor }, signal: controller.signal } as ApiRequest<R>) as Page<unknown>;
                        items.push(...next.items);
                        cursor = next.nextCursor;
                    }
                    value = { items, nextCursor: null } as ApiRoutes[R]["res"];
                }
                if (active) {
                    setData(value);
                    setLoading(false);
                }
            }
            catch (reason) {
                if (active) {
                    setError(reason instanceof Error ? reason : new Error("Could not load this view"));
                    setLoading(false);
                }
            }
        }
        void load();
        return () => { active = false; controller.abort(); };
    }, [route, encoded, revision]);
    return { data, error, loading, reload: () => setRevision(n => n + 1), setData };
}
