// Quick start from the island: the same pair the app's own "new chat + send"
// runs — `session.create`, then `prompt.submit` on the runtime id it returned.
// Reusing that path (params from `desktopSessionCreateParams`, so profile, cwd,
// model and effort come from the same place a composer send takes them) is what
// keeps a session started from the island indistinguishable from one started in
// the app: same cwd, same profile, same overrides.
//
// No optimistic transcript row here: the island is not a transcript. The row it
// shows comes from the backend's own live snapshot (`session.active_list`) a
// moment later, which is the authority the sidebar reads too.
import { desktopSessionCreateParams } from '@/app/session/hooks/use-session-actions/session-create-request'
import { $gateway } from '@/store/gateway'
import { resolveNewSessionCwd } from '@/store/projects'
import type { SessionCreateResponse } from '@/types/hermes'

export interface IslandStartedSession {
  runtimeSessionId: string
  storedSessionId: null | string
}

export async function startIslandSession(text: string): Promise<IslandStartedSession> {
  const prompt = text.trim()

  if (!prompt) {
    throw new Error('Nothing to send')
  }

  const gateway = $gateway.get()

  if (!gateway) {
    throw new Error('Hermes is not connected')
  }

  const request = <T,>(method: string, params?: Record<string, unknown>): Promise<T> =>
    gateway.request(method, params ?? {}) as Promise<T>

  const created = await request<SessionCreateResponse>('session.create', await desktopSessionCreateParams(resolveNewSessionCwd()))

  if (!created?.session_id) {
    throw new Error('The new session did not return a runtime id')
  }

  await request('prompt.submit', { session_id: created.session_id, text: prompt })

  return { runtimeSessionId: created.session_id, storedSessionId: created.stored_session_id ?? null }
}
