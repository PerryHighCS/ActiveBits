export const MOB_CODE_JSON_BODY_LIMIT = '8mb'

export function isMobCodeJsonRoute(pathname: string): boolean {
  return pathname === '/api/mobcode' || pathname.startsWith('/api/mobcode/')
}
