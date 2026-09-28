import { describe, expect, it, vi } from 'vitest'
import { saveSettingsForms } from '../app/utils/settings-save'

describe('enregistrement des réglages dans l’interface', () => {
  it('affiche le message API sans annoncer de succès ni modifier le profil après un rejet', async () => {
    const request = vi.fn().mockRejectedValue({
      data: {
        statusMessage: "L'heure de génération doit être comprise entre 00:00 et 23:59.",
      },
    })

    const result = await saveSettingsForms(request, { generationTime: '99:99' }, { age: 30 })

    expect(result).toEqual({
      ok: false,
      message: "L'heure de génération doit être comprise entre 00:00 et 23:59.",
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('/api/settings', {
      method: 'PUT',
      body: { generationTime: '99:99' },
    })
  })

  it('ne renvoie un succès qu’après les deux sauvegardes', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true })

    await expect(saveSettingsForms(request, { timezone: 'UTC' }, { age: 30 })).resolves.toEqual({
      ok: true,
    })
    expect(request.mock.calls.map(([url]) => url)).toEqual(['/api/settings', '/api/profile'])
  })
})
