export interface SettingsSaveRequestOptions {
  method: 'PUT'
  body: Record<string, unknown>
}

export type SettingsSaveRequest = (
  request: string,
  options: SettingsSaveRequestOptions,
) => Promise<unknown>

export type SettingsSaveResult = { ok: true } | { ok: false; message?: string }

export function requestErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { data?: { statusMessage?: unknown }; message?: unknown }
  if (typeof candidate.data?.statusMessage === 'string') return candidate.data.statusMessage
  return typeof candidate.message === 'string' ? candidate.message : undefined
}

/**
 * Sauvegarde d'abord les réglages horaires : un rejet ne doit pas modifier le profil ni produire
 * un résultat de succès partiel dans l'interface.
 */
export async function saveSettingsForms(
  request: SettingsSaveRequest,
  settingsBody: Record<string, unknown>,
  profileBody: Record<string, unknown>,
): Promise<SettingsSaveResult> {
  try {
    await request('/api/settings', { method: 'PUT', body: settingsBody })
    await request('/api/profile', { method: 'PUT', body: profileBody })
    return { ok: true }
  } catch (error) {
    return { ok: false, message: requestErrorMessage(error) }
  }
}
