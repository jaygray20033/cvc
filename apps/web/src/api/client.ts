import type { paths } from './generated/schema';

// Type-safe API surface generated from openapi.json (pnpm gen:api).
export type ApiPaths = paths;

// Paths that support GET with a 200 JSON response.
type GetPaths = {
  [P in keyof paths]: paths[P] extends {
    get: { responses: { 200: { content: { 'application/json': unknown } } } };
  }
    ? P
    : never;
}[keyof paths];

type GetResponse<P extends GetPaths> =
  paths[P]['get']['responses'][200]['content']['application/json'];

// Typed GET: the response type is derived from the OpenAPI schema.
export async function apiGet<P extends GetPaths>(path: P, baseUrl = ''): Promise<GetResponse<P>> {
  const res = await fetch(`${baseUrl}${String(path)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return (await res.json()) as GetResponse<P>;
}
