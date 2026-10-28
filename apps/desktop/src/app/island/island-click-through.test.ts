import { afterEach, describe, expect, it } from 'vitest'

import { islandIgnoresMouse } from './island-click-through'

function mount() {
  document.body.innerHTML = `
    <div id="root">
      <div data-island-surface>
        <button id="deny">Deny</button>
      </div>
    </div>
  `

  return document.querySelector('[data-island-surface]')
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('islandIgnoresMouse', () => {
  it('hands the mouse to the app behind anywhere outside the painted surface', () => {
    const surface = mount()

    // The window is a transparent rectangle much larger than the pill, so a hit
    // on the scaffolding is a hit on nothing.
    expect(islandIgnoresMouse(document.body, surface)).toBe(true)
    expect(islandIgnoresMouse(document.getElementById('root'), surface)).toBe(true)
    expect(islandIgnoresMouse(null, surface)).toBe(true)
  })

  it('is solid on the surface and on everything it contains', () => {
    const surface = mount()

    expect(islandIgnoresMouse(surface, surface)).toBe(false)
    expect(islandIgnoresMouse(document.getElementById('deny'), surface)).toBe(false)
  })

  it('stays click-through when the surface has not rendered yet', () => {
    expect(islandIgnoresMouse(document.body, null)).toBe(true)
  })
})
