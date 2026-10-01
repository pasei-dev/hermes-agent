import { atom, computed } from 'nanostores'

import { findGroup, findGroupOfPane } from '@/components/pane-shell/tree/model'
import { $activeTreeGroup, $layoutTree } from '@/components/pane-shell/tree/store'
import { $workspaceMode } from '@/components/pane-shell/workspace-scope'

// The sidebar still owns keyboard focus, but navigating its chrome must not
// replace the chat being worked in with the route's (possibly hidden) primary.
const $lastContentGroup = atom<null | string>(null)

$activeTreeGroup.subscribe(groupId => {
  const tree = $layoutTree.get()
  const active = groupId && tree ? findGroup(tree, groupId)?.active : undefined

  if (active !== 'sessions') {
    $lastContentGroup.set(groupId)
  }
})

/** Pane ids that ARE a session surface: the primary chat, and every session tile. */
export function isSessionSurfacePane(paneId: null | string | undefined): boolean {
  return paneId === 'workspace' || Boolean(paneId?.startsWith('session-tile:'))
}

export const $focusedTreePaneId = computed(
  [$activeTreeGroup, $layoutTree, $workspaceMode, $lastContentGroup],
  (groupId, tree, workspaceMode, lastContentGroup) => {
    let active = groupId && tree ? findGroup(tree, groupId)?.active : undefined

    if (active === 'sessions' && tree) {
      const content = lastContentGroup ? findGroup(tree, lastContentGroup) : null
      active = (content ?? findGroupOfPane(tree, 'workspace'))?.active
    }

    if (active?.startsWith('session-tile:')) {
      return active
    }

    // Bot chats are tiles, never the primary selection. Sidebar roster focus
    // must not publish a null session and let the Bots home reclaim the chat.
    if (workspaceMode === 'bots' && tree) {
      const mainActive = findGroupOfPane(tree, 'workspace')?.active

      if (mainActive?.startsWith('session-tile:')) {
        return mainActive
      }
    }

    return active
  }
)

/**
 * True when the honoured interaction zone is a pane that is NOT a session
 * surface — a click that landed outside every session pane (the preview rail, a
 * contributed plugin pane, the file browser). Such a click must not re-home the
 * focused session to the route's primary: with several session tabs open that
 * primary is the FIRST tab, so the pane snapped back to it (#75311).
 */
export const $focusedPaneIsForeign = computed($focusedTreePaneId, paneId =>
  Boolean(paneId) && !isSessionSurfacePane(paneId)
)
