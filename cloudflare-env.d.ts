interface Fetcher { fetch(request: Request): Promise<Response> }
interface D1PreparedStatement { bind(...values: unknown[]): D1PreparedStatement; first<T=unknown>(): Promise<T|null>; all<T=unknown>(): Promise<{results:T[]}> }
interface D1Database { prepare(sql:string):D1PreparedStatement; batch(statements:D1PreparedStatement[]):Promise<unknown[]> }
declare module "cloudflare:workers" { export const env: { DB: D1Database } }
