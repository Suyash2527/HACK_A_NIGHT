import type { ApiErrorBody, ApiRoute, ApiRoutes } from "@/types/api"

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true"
type RouteResult<R extends ApiRoute> = ApiRoutes[R]["res"]
type BodyFor<R extends ApiRoute> = ApiRoutes[R] extends { body: infer B } ? { body: B } : { body?: never }
type QueryFor<R extends ApiRoute> = ApiRoutes[R] extends { query: infer Q } ? { query?: Q } : { query?: never }
type FormFor<R extends ApiRoute> = ApiRoutes[R] extends { form: infer F } ? { form: F } : { form?: never }
export type ApiRequest<R extends ApiRoute> = BodyFor<R> & QueryFor<R> & FormFor<R> & { params?: Record<string, string | number>; mock?: RouteResult<R>; signal?: AbortSignal; live?: boolean }

export class ApiClientError extends Error {
  constructor(public status: number, public payload: ApiErrorBody) { super(payload.error.message) }
}

export async function apiFetch<R extends ApiRoute>(route: R, request = {} as ApiRequest<R>): Promise<RouteResult<R>> {
  if (USE_MOCKS && !request.live && request.mock !== undefined) return request.mock
  if (USE_MOCKS && !request.live && (route === "GET /api/documents/[id]" || route === "GET /api/cases/[id]" || route === "GET /api/cases/[id]/progress")) throw new ApiClientError(404, { error: { code: "NOT_FOUND", message: "Record unavailable" } })
  if (USE_MOCKS && !request.live) throw new ApiClientError(503, { error: { code: "FEATURE_DISABLED", message: "No simulated response is configured for this action." } })
  const [method, template] = route.split(" ") as [string, string]
  let path = template
  for (const [key, value] of Object.entries(request.params ?? {})) path = path.replace(`[${key}]`, encodeURIComponent(String(value)))
  const search = new URLSearchParams()
  Object.entries((request.query ?? {}) as Record<string, unknown>).forEach(([key, value]) => { if (value !== undefined) search.set(key, String(value)) })
  const init: RequestInit = { method, credentials: "include", cache: "no-store", signal: request.signal }
  if (request.form) {
    const data = new FormData()
    Object.entries(request.form as Record<string, unknown>).forEach(([key, value]) => { if (value !== undefined) data.append(key, value instanceof Blob ? value : String(value)) })
    init.body = data
  } else if (request.body !== undefined) { init.headers = { "Content-Type": "application/json" }; init.body = JSON.stringify(request.body) }
  const response = await fetch(search.size ? `${path}?${search}` : path, init)
  if (!response.ok) throw new ApiClientError(response.status, await response.json() as ApiErrorBody)
  if (route === "GET /api/documents/[id]/content" || route === "GET /api/cases/[id]/bundle") {
    const blob=await response.blob()
    const disposition=response.headers.get("Content-Disposition")??""
    const encodedName=disposition.split("filename*=UTF-8''")[1]?.split(";")[0]
    const plainName=disposition.split('filename="')[1]?.split('"')[0]
    let filename=plainName
    if(encodedName){try{filename=decodeURIComponent(encodedName)}catch{}}
    return (filename?new File([blob],filename,{type:blob.type}):blob) as RouteResult<R>
  }
  return await response.json() as RouteResult<R>
}
