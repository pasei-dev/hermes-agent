// Mouse passthrough for the island.
//
// An always-on-top window eats every click inside its rectangle, visible or
// not, and `pointer-events: none` does not help: that is a page-level property
// and the click never reaches the page. So the WINDOW is made mouse-transparent
// except where the island actually paints — which is why main spawns it
// click-through and the renderer re-arms it here on hover. `forward: true`
// keeps mousemove flowing while clicks pass through, so the re-arm happens the
// moment the cursor reaches the pill.
import { type RefObject, useEffect } from 'react'

/** Marks the painted pill/card. Everything else in the window is scaffolding. */
export const ISLAND_SURFACE_SELECTOR = '[data-island-surface]'

/**
 * Whether the OS window should hand the mouse to whatever is behind it.
 *
 * `hit` is what the document reports under the cursor. A hit inside the island
 * surface (or inside the surface's own descendants — a button, a row) means the
 * user is aiming at the island; anything else — `<body>`, `#root`, the
 * transparent margin around the pill — means the window is not really there.
 */
export function islandIgnoresMouse(hit: Element | null, surface: Element | null): boolean {
  return !(hit && surface && (hit === surface || surface.contains(hit)))
}

export function useIslandClickThrough(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const bridge = window.hermesDesktop?.island
    const root = rootRef.current

    if (!bridge?.setInteractive || !root) {
      return
    }

    let solid: boolean | null = null

    const apply = (next: boolean) => {
      if (next === solid) {
        return
      }

      solid = next
      bridge.setInteractive?.(next)
    }

    const onMove = (event: MouseEvent) => {
      const surface = root.querySelector(ISLAND_SURFACE_SELECTOR)
      const hit = document.elementFromPoint(event.clientX, event.clientY)

      apply(!islandIgnoresMouse(hit, surface))
    }

    // The pointer can leave without a further move (window switch, a display
    // edge) — hand the mouse back rather than leaving the window solid over
    // whatever sits under it.
    const onLeave = () => apply(false)

    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseleave', onLeave, true)

    return () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseleave', onLeave, true)
      apply(false)
    }
  }, [rootRef])
}
