import type { MobCodeThemeId } from '../../shared/types'
import { DEFAULT_MOB_CODE_THEME, MOB_CODE_THEME_COOKIE, MOB_CODE_THEMES } from './constants'

const THEME_IDS = new Set(MOB_CODE_THEMES.map((theme) => theme.id))

export function normalizeMobCodeTheme(value: unknown): MobCodeThemeId {
  return typeof value === 'string' && THEME_IDS.has(value as MobCodeThemeId)
    ? (value as MobCodeThemeId)
    : DEFAULT_MOB_CODE_THEME
}

export function getThemeFromCookie(cookieString = globalThis.document?.cookie ?? ''): MobCodeThemeId {
  const match = cookieString
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${MOB_CODE_THEME_COOKIE}=`))
  if (!match) return DEFAULT_MOB_CODE_THEME
  return normalizeMobCodeTheme(decodeURIComponent(match.slice(MOB_CODE_THEME_COOKIE.length + 1)))
}

export function setThemeCookie(theme: MobCodeThemeId): void {
  if (typeof document === 'undefined') return
  const oneYearSeconds = 60 * 60 * 24 * 365
  document.cookie = `${MOB_CODE_THEME_COOKIE}=${encodeURIComponent(theme)}; path=/; max-age=${oneYearSeconds}; SameSite=Lax`
}
