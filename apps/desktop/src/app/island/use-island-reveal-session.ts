// App-window side of the island's "show me this chat".
//
// The island's card is a pointer, not a place: a click on it brings the app
// window forward (main does that) and then this side selects the pane the
// session ALREADY has. Nothing is opened — no tab, no tile, no main swap — so a
// press on the island can never spend a pane or start a session the user did not
// ask for. Selection goes through the sidebar's own door: `focusOpenSession` is
// what a click on an open row does.
import { useEffect, useRef } from 'react'

import { markSessionRead } from '@/store/session'
import { focusedSessionNeedsRoute, focusOpenSession } from '@/store/session-states'
import { isIslandWindow } from '@/store/windows'

import type { OpenSessionNavigate } from '../open-session'
import { $workspaceIsPage, sessionRoute } from '../routes'

export function useIslandRevealSession(navigate: OpenSessionNavigate): void {
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  useEffect(() => {
    // The island's own renderer mounts the same wiring; it is the sender.
    if (isIslandWindow()) {
      return
    }

    return window.hermesDesktop?.island?.onRevealSession?.(sessionId => {
      const focused = focusOpenSession(sessionId)

      if (!focused) {
        // No pane of its own: the window is already forward, and opening a
        // second one is the thing this door exists to avoid.
        return
      }

      // A 'main' hit only reaches the screen when the workspace is showing the
      // chat; the route may still be on a page (skills, artifacts, …).
      if (focusedSessionNeedsRoute(focused, $workspaceIsPage.get())) {
        navigateRef.current(sessionRoute(sessionId))
      }

      markSessionRead(sessionId)
    })
  }, [])
}
