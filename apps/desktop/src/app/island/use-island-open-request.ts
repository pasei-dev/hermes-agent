// App-window side of the island's "open this chat".
//
// The island's row is a pointer, not a place: the chat belongs in the app
// window, so main brings that window forward and hands this side the session id.
// Opening it uses the ordinary door (`app/open-session`) — the island has no
// opinion about whether the session becomes the main tab or a tile, and the
// user's own layout rules decide, exactly as a sidebar click does.
import { useEffect, useRef } from 'react'

import { isIslandWindow } from '@/store/windows'

import { openSession, type OpenSessionNavigate } from '../open-session'

export function useIslandOpenRequest(navigate: OpenSessionNavigate): void {
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  useEffect(() => {
    // The island's own renderer mounts the same wiring; it is the sender.
    if (isIslandWindow()) {
      return
    }

    return window.hermesDesktop?.island?.onOpenSession?.(sessionId => {
      openSession(sessionId, navigateRef.current)
    })
  }, [])
}
