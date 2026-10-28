// The Dynamic Island — the whole of it.
//
// A view over the app's stores, mounted by `ContribController` inside
// `<ContribWiring>`, which is what makes it a real part of the app rather than a
// second implementation: the gateway, the live session snapshot (1.5s
// `session.active_list`), the parked prompts and the send path are the same
// objects every other surface reads.
//
// Four stages over ONE window (see electron/island-window.ts). The shape is a CSS
// transition inside a fixed rectangle, so it animates on the compositor instead
// of resizing the OS window per frame.
//   notch      — idle: a black pill the size and place of the notch itself, so it
//                hides IN the housing rather than floating under it. Where there
//                is no housing there is nothing to hide inside, so idle is fully
//                transparent and takes no space at all.
//   pill       — something is running: a dot and a count.
//   attention — a turn is parked on the user. The island grows BY ITSELF (main
//               shows it with `showInactive`, so the caret stays in the app the
//               user is in) and puts Deny/Approve one click away.
//   expanded   — the running list plus a quick-start field.
import { useStore } from '@nanostores/react'
import {
  type FocusEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useNavigate } from 'react-router'

import { WiredPane } from '@/app/contrib/wiring'
import { sessionRoute } from '@/app/routes'
import { Button } from '@/components/ui/button'
import { isRtlLocale, useI18n } from '@/i18n'
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $busyInputConfig } from '@/store/busy-input-mode'
import { $clarifyRequests, RECOMMENDED_LABEL } from '@/store/clarify'
import { $queuedPromptsBySession } from '@/store/composer-queue'
import { $gateway } from '@/store/gateway'
import { $island, saveIslandSettings } from '@/store/island'
import { sessionApprovalStackSize } from '@/store/prompts'
import { $sessions, sessionMatchesStoredId } from '@/store/session'
import { $attentionSessionIds, $sessionStates, $workingSessionIds } from '@/store/session-states'
import { $unreadFinishedMarkers, ackStoredSessionId } from '@/store/session-unread'

import { islandQueueView } from './island-actions'
import { $islandActivityBySession, type IslandActivity } from './island-activity'
import { useIslandClickThrough } from './island-click-through'
import { islandAnsweredNotice, type IslandRow, islandRows, type IslandStage, islandStage } from './island-model'
import {
  type IslandTranscriptRow,
  readIslandTranscript,
  submitToIslandSession
} from './island-session'
import { type IslandDockSide, islandDockSide, islandShape } from './island-view'
import { type IslandApprovalChoice, type IslandApprovalOptions, useIslandApprovals } from './use-island-approvals'

/** macOS's own expansion curve — fast out, long settle. */
const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)'

/** A dragged size, kept inside the window's ceiling and above the size that
 *  still holds a header and a line of transcript. */
const limitSize = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)))
const MORPH = `width 380ms ${SPRING}, height 380ms ${SPRING}, border-radius 300ms ${SPRING}, opacity 200ms ease-out, transform 300ms ${SPRING}`
const REVEAL = `opacity 220ms ease-out 60ms, transform 320ms ${SPRING} 40ms`

const DOT = 'size-1.5 shrink-0 rounded-full'
const ROW = 'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-white/10'
const GLYPH = 'text-white/55 hover:text-white'
/** A press that travels less than this is a click, not a drag. */
const DRAG_THRESHOLD = 3

/**
 * At rest the pill is a status strip, not a toolbar: its buttons are there when
 * the pointer is, and take no colour from the surface otherwise. Expanded, the
 * list is open and every glyph stays visible.
 */
const REST_CHROME =
  'pointer-events-none opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:opacity-100'

function islandNotched(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('notch') === '1'
  } catch {
    return false
  }
}

export function IslandShell() {
  const { locale, t } = useI18n()
  const navigate = useNavigate()
  const rtl = isRtlLocale(locale)
  const notched = useMemo(islandNotched, [])
  const sessions = useStore($sessions)
  const attentionIds = useStore($attentionSessionIds)
  const workingIds = useStore($workingSessionIds)

  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<null | string>(null)
  /** True between the pointer travelling and the release: no CSS transition runs
   *  while the window itself is moving, or every frame re-rasterises the text. */
  const [dragging, setDragging] = useState(false)
  /** At rest the pill is a dot; the line and the width appear under the pointer. */
  const [hovered, setHovered] = useState(false)
  /** The list's own search: the island is also the quickest way back in. */
  const [query, setQuery] = useState('')

  // Deny is a two-tap verb on purpose: the first tap opens the reason field, the
  // second denies with whatever is in it. A plain deny stays one tap away for the
  // card that is already on screen, and the reason never arrives by accident.
  const [denyFor, setDenyFor] = useState<null | string>(null)
  const [denyReason, setDenyReason] = useState('')

  // The one session opened in place: its last lines and a prompt that runs it.
  const [focused, setFocused] = useState<null | { id: string; title: string }>(null)
  const [transcript, setTranscript] = useState<IslandTranscriptRow[]>([])
  const [transcriptError, setTranscriptError] = useState<null | string>(null)
  const runtimeRef = useRef<null | string>(null)
  const [sessionDraft, setSessionDraft] = useState('')
  const [sessionBusy, setSessionBusy] = useState(false)

  // Main owns where the window is; the surface follows it. A docked island
  // squares the corners against that edge and hugs it, so an edge is an edge and
  // not a pill that happens to be nearby.
  const [dock, setDock] = useState<IslandDockSide>('free')
  // The app window has the keyboard. The island is a notification, not a HUD:
  // while the user is reading Hermes itself it goes back into the notch.
  const [mainFocused, setMainFocused] = useState(false)

  useEffect(() => {
    const offDock = window.hermesDesktop?.island?.onDock?.(side => setDock(islandDockSide(side)))
    const offFocus = window.hermesDesktop?.island?.onMainFocus?.(setMainFocused)

    return () => {
      offDock?.()
      offFocus?.()
    }
  }, [])

  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const tailRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<null | { moved: boolean; startX: number; startY: number; x: number; y: number }>(null)

  const { approvalsById, answer } = useIslandApprovals(attentionIds)

  // Titles come from the stored session list; attention/working ids are stored
  // ids already (lineage-expanded), so the app's own matcher resolves them.
  const titles = useMemo(() => {
    const map: Record<string, string> = {}

    for (const id of [...attentionIds, ...workingIds]) {
      const row = sessions.find(session => sessionMatchesStoredId(session, id))

      if (row?.title) {
        map[id] = row.title
      }
    }

    return map
  }, [attentionIds, sessions, workingIds])

  const rows = useMemo(
    () => islandRows({ approvalsById, attentionIds, titles, workingIds }),
    [approvalsById, attentionIds, titles, workingIds]
  )

  // Recent sessions, not only the running ones: the island is also the quickest
  // way back into something you left an hour ago. The field above the list
  // narrows the same rows, so search costs one filter and no second list.
  const recents = useMemo(() => {
    const listed = new Set(rows.map(row => row.id))
    const needle = query.trim().toLowerCase()

    return sessions
      .filter(session => !session.archived && !listed.has(session.id))
      .filter(session => !needle || (session.title ?? '').toLowerCase().includes(needle))
      .slice(0, 8)
  }, [query, rows, sessions])

  const waitingRows = rows.filter(row => row.state === 'needs-input')
  // An actionable row wins the card: a session waiting on a clarify has nothing
  // to click but "Open", and letting it outrank the approval below it meant the
  // one card on screen could not be answered at all.
  const top = waitingRows.find(row => row.approval) ?? waitingRows[0]

  // Everything else the island should open for, not just approvals: a clarify
  // question the agent is blocked on, and a turn that finished while the user
  // was elsewhere. Both already live in the app's stores — the island only had
  // one of the three wired.
  const clarifies = useStore($clarifyRequests)
  const unread = useStore($unreadFinishedMarkers)

  // The finished-turn card closes on its own, and this is the half of that the
  // store cannot do: `ackStoredSessionId` no-ops while the session's row is not
  // loaded, so a marker it could not clear held the island open forever.
  const [dismissedAnswerId, setDismissedAnswerId] = useState<null | string>(null)

  // The store is keyed by profile, and its values are the finished session ids:
  // reading the KEYS handed this card a profile name, which no row matches and
  // no acknowledge can clear — the island stayed open on a marker that was never
  // a session.
  const answeredId =
    top || waitingRows.length > 0
      ? null
      : islandAnsweredNotice({
          dismissed: dismissedAnswerId,
          markerIds: Object.values(unread).flat(),
          rowIds: rows.map(row => row.id)
        })

  // A finished session is rarely in `titles` (that map covers only the waiting
  // and the working), so its card fell back to "Waiting on your answer" — a
  // status it does not have.
  const answeredTitle = useMemo(() => {
    if (!answeredId) {
      return ''
    }

    return sessions.find(session => sessionMatchesStoredId(session, answeredId))?.title ?? ''
  }, [answeredId, sessions])

  const cardRow: IslandRow | null =
    top ?? (answeredId ? { id: answeredId, state: 'working', title: answeredTitle } : null)

  const clarify = cardRow ? clarifies[cardRow.id] : undefined
  const question = clarify?.questions[0]
  const answered = Boolean(cardRow && !top && !clarify)
  const [clarifyDraft, setClarifyDraft] = useState('')
  const [answerPreview, setAnswerPreview] = useState<null | string>(null)

  // The answer itself: the tail of the transcript, read once per finished
  // session rather than polled — nothing here needs to be live.
  useEffect(() => {
    if (!answeredId) {
      setAnswerPreview(null)

      return
    }

    let cancelled = false
    void readIslandTranscript(answeredId)
      .then(lines => {
        if (!cancelled) {
          setAnswerPreview(lines.filter(line => line.role === 'assistant').at(-1)?.text ?? null)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [answeredId])

  // An answer is a notification, not a state: it holds the island open long
  // enough to be read, then acknowledges itself. A finished card that stayed
  // until it was clicked is why the island never collapsed again.
  useEffect(() => {
    if (!answeredId) {
      return
    }

    // Six seconds: long enough to read one line, short enough that the island is
    // gone before the user looks up. Focused, there is nothing to tell them —
    // they are reading the app itself — so it clears at once.
    const timer = setTimeout(() => {
      setDismissedAnswerId(answeredId)
      ackStoredSessionId(answeredId)
    }, mainFocused ? 0 : 6_000)

    return () => clearTimeout(timer)
  }, [answeredId, mainFocused])

  // A clarify is answered by talking: the same submit the composer uses.
  const answerClarify = useCallback(
    async (text: string) => {
      const gateway = $gateway.get()
      const target = cardRow?.id

      if (!gateway || !target || !text.trim()) {
        return
      }

      setError(null)

      try {
        await submitToIslandSession(
          (method, params) => gateway.request(method, params ?? {}) as Promise<never>,
          target,
          text.trim()
        )
        setClarifyDraft('')
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    },
    [cardRow?.id]
  )

  // How many approvals this session has parked, so "Approve all" is only offered
  // when there is a second one behind the card to actually resolve.
  const depthAtom = useMemo(() => sessionApprovalStackSize(top?.id ?? null), [top?.id])
  const approvalDepth = useStore(depthAtom)

  // A reason field belongs to the card it was opened on: when that card is
  // answered or replaced by the next one, the half-typed reason goes with it.
  useEffect(() => {
    setDenyFor(null)
    setDenyReason('')
  }, [top?.approval?.requestId])
  const runningCount = rows.filter(row => row.state === 'working').length

  // The session the pill speaks for: the one waiting on you, else the first running.
  const lead = top ?? rows[0]
  const activities = useStore($islandActivityBySession)
  const states = useStore($sessionStates)
  const queues = useStore($queuedPromptsBySession)
  const busyMode = useStore($busyInputConfig)?.mode ?? null
  const activity = lead ? activities[lead.id] : undefined

  // No clock on the island: a timer ticking once a second to say how long
  // something has been running is a wakeup and a glyph that never changed a
  // decision. The activity line carries what it is doing instead.

  // Tool, plan progress, workers — that reading order, and nothing at all for a
  // session that has none of them, so callers can fall back to a count.
  const describe = useCallback(
    (own: IslandActivity | undefined): string[] => {
      if (!own) {
        return []
      }

      const parts: string[] = []

      if (own.tool) {
        parts.push(own.tool)
      }

      if (own.todoTotal > 0) {
        parts.push(`${own.todoDone}/${own.todoTotal}`)
      }

      if (own.workers > 0) {
        parts.push(t.island.workers(own.workers))
      }

      return parts
    },
    [t]
  )

  const activityParts = describe(activity)

  // The session view's first line: what that session is doing right now. The
  // transcript under it is history, and history is why the old view was useless
  // the moment a turn started — it showed four finished bubbles and no state.
  const focusedActivity = focused ? activities[focused.id] : undefined
  const nowLine = describe(focusedActivity).join(' · ')

  // Stored id → runtime id: `session.interrupt` and the live-turn flag both speak the
  // runtime id, and every row the island lists is a stored id.
  const runtimeId = useMemo(() => {
    const wanted = focused?.id ?? lead?.id

    if (!wanted) {
      return null
    }

    for (const [runtime, state] of Object.entries(states)) {
      if (state.storedSessionId === wanted) {
        return runtime
      }
    }

    return null
  }, [focused?.id, lead?.id, states])

  const liveTurn = runtimeId ? Boolean(states[runtimeId]?.turnLive) : false

  const queued = useMemo(() => {
    for (const id of [runtimeId, focused?.id, lead?.id]) {
      const entries = id ? queues[id] : undefined

      if (entries && entries.length > 0) {
        return islandQueueView(entries)
      }
    }

    return null
  }, [focused?.id, lead?.id, queues, runtimeId])

  const rawStage = islandStage({
    attentionCount: waitingRows.length + (answeredId ? 1 : 0),
    expanded,
    focused: focused !== null,
    workingCount: runningCount
  })

  const quiet = mainFocused && !expanded && focused === null && !top?.approval && !question
  const stage: IslandStage = quiet ? 'hidden' : rawStage

  // The panel's size is the user's: a grip's live drag wins, then the size they
  // last dragged it to, then the window's ceiling.
  const islandPrefs = useStore($island)
  const [liveSize, setLiveSize] = useState<{ height: number; width: number } | null>(null)
  const gripRef = useRef<null | { height: number; startX: number; startY: number; width: number }>(null)
  const gripPending = useRef<{ height: number; width: number } | null>(null)
  const sessionSize = liveSize ?? islandPrefs.sessionSize ?? undefined

  const shape = islandShape({
    // A card that carries a question is taller: two lines of it, up to three
    // answers, and the field. Sized from the kind, so nothing is drawn past the
    // surface's own bottom edge.
    cardHeight: question ? 184 : answered ? 120 : 104,
    notched,
    // Nothing running, nothing waiting: the pill is a dot in the notch. The richer
    // width is a hover affordance, so the island stops being a strip of text on
    // top of whatever the user is doing.
    rich: stage === 'pill' && activityParts.length > 0 && hovered,
    rows: stage === 'session' ? transcript.length : rows.length,
    sessionSize,
    stage
  })

  // Collapsed with something running and nothing waiting: the pill's only job is
  // the dot and the line, so its buttons wait for the pointer.
  const atRest = stage === 'pill'

  useIslandClickThrough(rootRef)

  // Main holds the window hidden until this lands: the island is a full renderer,
  // so its first paint is the app's boot screen.
  useEffect(() => {
    window.hermesDesktop?.island?.ready?.()
  }, [])

  // Point the app at a session, never at a second pane or a new one: main fronts
  // the Hermes window and the app selects a pane it already has. This is the
  // island's only way to bring the app forward, so nothing else here calls it.
  const revealSession = useCallback(
    (id: string) => {
      if (!id) {
        return
      }

      // Asking for it is the acknowledgement: the notice has been read.
      if (id === answeredId) {
        setDismissedAnswerId(id)
      }

      window.hermesDesktop?.island?.revealSession?.(id)
      setExpanded(false)
      setFocused(null)
    },
    [answeredId]
  )

  const refreshTranscript = useCallback(async (id: string) => {
    try {
      setTranscript(await readIslandTranscript(id))
      setTranscriptError(null)
    } catch (failure) {
      setTranscriptError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [])

  // Open one session in place instead of the whole window. The read is the desktop's
  // transcript endpoint, so it costs no runtime; the poll keeps the tail live while the
  // session is on screen (three seconds is a peek, not a chat view).
  const focusSession = useCallback(
    (row: IslandRow) => {
      runtimeRef.current = null
      setFocused({ id: row.id, title: row.title })
      setExpanded(false)
      // The chat routes read the routed session, so opening one in place is a
      // navigation: the same view the app shows, pointed at this session.
      navigate(sessionRoute(row.id))
    },
    [navigate]
  )

  useEffect(() => {
    if (stage !== 'session' || !focused) {
      return
    }

    const id = focused.id
    const timer = setInterval(() => void refreshTranscript(id), 3000)

    return () => clearInterval(timer)
  }, [focused, refreshTranscript, stage])

  // A tail reads from the bottom: the newest line is the one worth opening it for,
  // and a scroll box that keeps its scrollTop at 0 shows only the oldest.
  useEffect(() => {
    const box = tailRef.current

    if (box) {
      box.scrollTop = box.scrollHeight
    }
  }, [transcript])

  // Run the focused session from the island. Sending into a session another window has open
  // is supported by design (resume attaches this island as an extra viewer), so this never
  // takes the conversation away from the app.
  const sendToSession = useCallback(async () => {
    const gateway = $gateway.get()

    if (!focused || !sessionDraft.trim() || sessionBusy) {
      return
    }

    if (!gateway) {
      setTranscriptError('Hermes is not connected')

      return
    }

    setSessionBusy(true)
    setTranscriptError(null)

    try {
      const text = sessionDraft.trim()

      runtimeRef.current = await submitToIslandSession(
        (method, params) => gateway.request(method, params ?? {}) as Promise<never>,
        focused.id,
        text,
        runtimeRef.current
      )
      // The turn's own rows land a moment later; read twice so the echo shows up.
      setTimeout(() => void refreshTranscript(focused.id), 1200)
      setTimeout(() => void refreshTranscript(focused.id), 3500)
      setSessionDraft('')
    } catch (failure) {
      setTranscriptError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSessionBusy(false)
    }
  }, [focused, refreshTranscript, sessionBusy, sessionDraft])

  const respond = useCallback(
    (row: IslandRow, choice: IslandApprovalChoice, options?: IslandApprovalOptions) => {
      if (!row.approval) {
        return
      }

      setError(null)
      setDenyFor(null)
      setDenyReason('')
      void answer(row.id, row.approval.requestId, choice, options).catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : String(failure))
      )
    },
    [answer]
  )

  // The approval chord arrives from main as a bare event, because main speaks no
  // gateway: this window owns the one answer path, so the chord only says "now".
  useEffect(() => {
    const stop = window.hermesDesktop?.island?.onApproveTop?.(() => {
      if (top?.approval) {
        respond(top, 'once')
      }
    })

    return () => stop?.()
  }, [respond, top])

  // The expand chord: same door, one gesture. Opening the list is a keyboard act,
  // so the window takes the keyboard with it — a list you cannot type into is
  // not what the chord promised.
  useEffect(() => {
    const stop = window.hermesDesktop?.island?.onExpand?.(() => {
      window.hermesDesktop?.island?.setFocusable?.(true)
      setExpanded(true)
    })

    return () => stop?.()
  }, [])

  // Typing is the ONE case that asks for the keyboard. Main keeps the window
  // non-activating otherwise, so a click on Deny never pulls Hermes forward.
  const focusIsland = useCallback((element: HTMLElement | null) => {
    if (!element) {
      return
    }

    window.hermesDesktop?.island?.setFocusable?.(true)
    requestAnimationFrame(() => element.focus())
  }, [])

  const onSurfaceBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null

    if (!next || !event.currentTarget.contains(next)) {
      window.hermesDesktop?.island?.setFocusable?.(false)
    }
  }, [])

  // Dragging belongs to the displays without a housing: there the island is the
  // user's to park, and the window follows the pointer's own travel because the
  // renderer is the only side that sees the press. A press that never travels is
  // a click, and a click opens the list — that is the one gesture the surface
  // owes a user who has no chevron in sight.
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return
      }

      if ((event.target as HTMLElement).closest('button, input, a, [data-island-attention]')) {
        return
      }

      // A press on the pill is a drag or a toggle, never a request for the
      // keyboard: without this the click activates Hermes and the app window
      // comes forward over whatever the user was doing.
      event.preventDefault()
      dragRef.current = { moved: false, startX: event.screenX, startY: event.screenY, x: event.screenX, y: event.screenY }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    []
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const from = dragRef.current

      if (!from) {
        return
      }

      // A press is a click until it travels: three pixels of hand tremor must not
      // nudge the window.
      if (!from.moved) {
        if (Math.abs(event.screenX - from.startX) + Math.abs(event.screenY - from.startY) < DRAG_THRESHOLD) {
          return
        }

        from.moved = true
        setDragging(true)
      }

      // SCREEN coordinates, never client ones: the window moves under the
      // pointer, so a client delta shrinks by exactly the distance just moved and
      // the island crawls behind the cursor instead of following it.
      const dx = event.screenX - from.x
      const dy = event.screenY - from.y

      if (dx === 0 && dy === 0) {
        return
      }

      window.hermesDesktop?.island?.drag?.({ dx, dy })
      from.x = event.screenX
      from.y = event.screenY
    },
    []
  )

  const cancelDrag = useCallback(() => {
    dragRef.current = null
    setDragging(false)
  }, [])

  // The surface is the expand control: a press that stayed put was a click.
  const endDrag = useCallback(() => {
    const from = dragRef.current
    dragRef.current = null
    setDragging(false)

    if (!from || from.moved || focused) {
      return
    }

    setError(null)
    setExpanded(next => !next)
  }, [focused])

  // Esc leaves: collapse the list first, and give the keyboard back when there
  // is nothing left to collapse.
  useEffect(() => {
    if (stage === 'hidden') {
      return
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      if (focused) {
        setFocused(null)
        setTranscript([])
        setExpanded(true)

        return
      }

      if (expanded) {
        setExpanded(false)
      } else {
        window.hermesDesktop?.island?.setFocusable?.(false)
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, focused, stage])

  const content = stage !== 'hidden'

  return (
    <div
      className="flex h-screen w-screen items-start justify-center overflow-hidden"
      dir={rtl ? 'rtl' : 'ltr'}
      onBlur={onSurfaceBlur}
      ref={rootRef}
      style={{
        justifyContent: dock === 'left' ? 'flex-start' : dock === 'right' ? 'flex-end' : 'center',
        paddingTop: notched || dock === 'top' ? 0 : 8
      }}
    >
      <div
        className={cn(
          'group pointer-events-auto select-none overflow-hidden bg-black text-white/90',
          // A housing has no shadow: the pill sits in the notch, and a halo there
          // paints a grey smear across the menu bar either side of it.
          notched
            ? 'shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.07)]'
            : 'shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.07),0_18px_40px_-12px_rgba(0,0,0,0.7)]'
        )}
        data-island-mode={shape.mode}
        data-island-stage={stage}
        data-island-surface=""
        onPointerCancel={cancelDrag}
        onPointerDown={onPointerDown}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        style={{
          // A docked island squares the corners against its edge: a capsule
          // floating 30px from the screen edge is not attached to it.
          borderRadius:
            notched || dock === 'free'
              ? shape.radius
              : dock === 'top'
                ? `0 0 ${shape.radius}px ${shape.radius}px`
                : dock === 'bottom'
                  ? `${shape.radius}px ${shape.radius}px 0 0`
                  : dock === 'left'
                    ? `0 ${shape.radius}px ${shape.radius}px 0`
                    : `${shape.radius}px 0 0 ${shape.radius}px`,
          cursor: focused ? undefined : notched ? 'pointer' : 'grab',
          height: shape.height,
          opacity: shape.opacity,
          transform: shape.opacity === 0 ? 'scale(0.92)' : dragging ? 'scale(1.03, 1.28)' : 'none',
          transformOrigin: 'top center',
          transition: dragging ? 'none' : MORPH,
          width: shape.width
        }}
      >
        <div
          className="flex h-full flex-col px-2.5 pt-1.5 pb-2"
          style={{
            opacity: content ? 1 : 0,
            transform: content ? 'none' : 'translateY(-6px)',
            transition: REVEAL
          }}
        >
          <div className="flex h-6 shrink-0 items-center gap-2">
            {focused ? (
              <Button
                aria-label={t.island.collapse}
                className={GLYPH}
                onClick={() => {
                  setFocused(null)
                  setTranscript([])
                  setExpanded(true)
                }}
                size="icon-xs"
                title={t.island.collapse}
                variant="ghost"
              >
                <ChevronLeft />
              </Button>
            ) : null}
            <span
              className={cn(
                DOT,
                waitingRows.length > 0 ? 'bg-amber-400' : runningCount > 0 ? 'bg-white' : 'bg-white/30'
              )}
            />
            <span className={cn('min-w-0 flex-1 truncate text-xs', atRest && !hovered && 'opacity-0')}>
              {focused
                ? focused.title || t.island.needsInput
                : waitingRows.length > 0
                  ? t.island.waiting(waitingRows.length)
                  : activityParts.length > 0
                    ? // The session's own name first: "shell · 3/7" says what tool a
                      // session is in, not which session it is.
                      [lead ? titles[lead.id] : '', ...activityParts].filter(Boolean).join(' · ')
                    : t.island.running(runningCount)}
            </span>
            <div className={cn('flex shrink-0 items-center gap-1', atRest && REST_CHROME)}>
              {queued && !focused ? (
                <span className="shrink-0 text-[0.65rem] text-white/35" title={queued.next}>
                  {queued.count} {t.island.queued}
                </span>
              ) : null}
              {focused || top ? (
                <Button
                  aria-label={t.island.open}
                  className={GLYPH}
                  onClick={() => revealSession(focused?.id ?? top?.id ?? '')}
                  size="icon-xs"
                  title={t.island.open}
                  variant="ghost"
                >
                  <ArrowUpRight />
                </Button>
              ) : null}
              {/* A chevron with nothing behind it invites a click that does nothing. */}
              {focused || rows.length === 0 ? null : (
                <Button
                  aria-expanded={expanded}
                  aria-label={expanded ? t.island.collapse : t.island.expand}
                  className={GLYPH}
                  onClick={() => {
                    setExpanded(next => {
                      if (!next) {
                        setError(null)
                      }

                      return !next
                    })
                  }}
                  size="icon-xs"
                  variant="ghost"
                >
                  {expanded ? <ChevronDown /> : <ChevronRight />}
                </Button>
              )}
            </div>
          </div>

          {cardRow ? (
            <div
              aria-live="polite"
              className="mt-1.5 shrink-0 rounded-xl bg-white/8 px-2 py-1.5 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.08)]"
              data-island-attention=""
              role="status"
            >
              <div className="flex items-baseline gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[0.7rem] text-white/55">
                  {cardRow.title || (answered ? t.island.finishedTitle : t.island.needsInput)}
                </span>
                {/* How deep the queue goes. Answering one advances the card, but a
                    single card on screen said nothing about the four behind it. */}
                {approvalDepth > 1 ? (
                  <span className="shrink-0 text-[0.65rem] tabular-nums text-amber-300/80">1 / {approvalDepth}</span>
                ) : null}
              </div>

              {cardRow.approval ? (
                <>
                  {/* The sentence that says why, before the command that says what. */}
                  {cardRow.approval.description ? (
                    <div className="mt-1 line-clamp-1 text-[0.7rem] text-white/70">
                      {cardRow.approval.description}
                    </div>
                  ) : null}
                  <div className="mt-0.5 line-clamp-2 font-mono text-[0.68rem] text-white/90">
                    {cardRow.approval.command}
                  </div>
                </>
              ) : question ? (
                /* Every answer the agent offered, each with its own number, in a
                   box that scrolls instead of growing past the surface. */
                <>
                  <div className="mt-1 line-clamp-2 text-[0.72rem] leading-snug text-white/85">
                    {question.question}
                  </div>
                  {(question.choices ?? []).length > 0 ? (
                    <div className="mt-1 max-h-[112px] overflow-y-auto">
                      <div className="flex flex-col gap-1">
                        {(question.choices ?? []).map((choice, index) => (
                          <button
                            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[0.7rem] text-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] hover:bg-white/10 hover:text-white"
                            key={choice}
                            onClick={() => void answerClarify(choice)}
                            type="button"
                          >
                            <span className="w-3 shrink-0 text-[0.62rem] tabular-nums text-white/40">
                              {index + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{choice.replace(RECOMMENDED_LABEL, '').trim()}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                /* A finished turn: its own last words, so the island answers
                   "what did it say" without opening anything. */
                <div className="mt-1 line-clamp-3 text-[0.72rem] text-white/80">
                  {answerPreview || t.island.finished}
                </div>
              )}

              <div className="mt-1.5 flex items-center gap-1.5">
                {cardRow.approval ? (
                  denyFor === cardRow.approval.requestId ? (
                    <>
                      <input
                        autoFocus
                        className="min-w-0 flex-1 bg-transparent px-1 text-[0.7rem] text-white/90 outline-none placeholder:text-white/35"
                        onChange={event => setDenyReason(event.target.value)}
                        onFocus={event => focusIsland(event.currentTarget)}
                        onPointerDown={event => focusIsland(event.currentTarget)}
                        placeholder={t.island.denyPlaceholder}
                        value={denyReason}
                      />
                      <Button
                        className="text-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] hover:bg-white/10 hover:text-white"
                        onClick={() => respond(cardRow, 'deny', { reason: denyReason })}
                        size="xs"
                        variant="outline"
                      >
                        {t.island.deny}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        className="text-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] hover:bg-white/10 hover:text-white"
                        onClick={() => {
                          setDenyReason('')
                          setDenyFor(cardRow.approval?.requestId ?? null)
                        }}
                        size="xs"
                        variant="outline"
                      >
                        {t.island.deny}
                      </Button>
                      <Button onClick={() => respond(cardRow, 'once')} size="xs" variant="secondary">
                        {t.island.approve}
                      </Button>
                      <Button
                        className="text-white/70 hover:bg-white/10 hover:text-white"
                        onClick={() => respond(cardRow, 'always')}
                        size="xs"
                        variant="ghost"
                      >
                        {t.island.always}
                      </Button>
                    </>
                  )
                ) : question ? (
                  <>
                    <input
                      className="min-w-0 flex-1 bg-transparent px-1 text-[0.7rem] text-white/90 outline-none placeholder:text-white/35"
                      onChange={event => setClarifyDraft(event.target.value)}
                      onFocus={event => focusIsland(event.currentTarget)}
                      onPointerDown={event => focusIsland(event.currentTarget)}
                      placeholder={t.island.answerPlaceholder}
                      value={clarifyDraft}
                    />
                    <Button
                      disabled={!clarifyDraft.trim()}
                      onClick={() => void answerClarify(clarifyDraft)}
                      size="xs"
                      variant="secondary"
                    >
                      {t.island.send}
                    </Button>
                  </>
                ) : (
                  /* The one thing on the island allowed to bring Hermes forward,
                     and it opens nothing: main fronts the window and the app
                     selects a pane it already has. */
                  <Button
                    aria-label={t.island.open}
                    className={GLYPH}
                    onClick={() => revealSession(cardRow.id)}
                    size="icon-xs"
                    title={t.island.open}
                    variant="ghost"
                  >
                    <ArrowUpRight />
                  </Button>
                )}
              </div>
            </div>
          ) : null}

          {error ? <div className="mt-1.5 shrink-0 px-1 text-[0.7rem] text-red-400">{error}</div> : null}

          {stage === 'expanded' ? (
            <div className="mt-1.5 flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto">
                {rows.length === 0 && recents.length === 0 ? (
                  <div className="px-2 py-1 text-[0.7rem] text-white/40">{t.island.empty}</div>
                ) : null}
                {rows.map(row => (
                  <button className={ROW} key={row.id} onClick={() => focusSession(row)} type="button">
                    <span className={cn(DOT, row.state === 'needs-input' ? 'bg-amber-400' : 'bg-white')} />
                    <span className="min-w-0 flex-1 truncate text-xs">{row.title || t.island.needsInput}</span>
                    <span className="shrink-0 text-[0.65rem] text-white/35">
                      {row.state === 'needs-input'
                        ? t.island.needsAnswer
                        : describe(activities[row.id]).join(' · ') || t.island.working}
                    </span>
                  </button>
                ))}
                {recents.length > 0 ? (
                  <div className="mt-1.5 px-2 text-[0.6rem] uppercase tracking-[0.08em] text-white/25">
                    {t.island.recent}
                  </div>
                ) : null}
                {recents.map(session => (
                  <button
                    className={ROW}
                    key={session.id}
                    onClick={() => focusSession({ id: session.id, state: 'working', title: session.title ?? '' })}
                    type="button"
                  >
                    <span className={cn(DOT, 'bg-white/25')} />
                    <span className="min-w-0 flex-1 truncate text-xs text-white/75">
                      {session.title || t.island.needsInput}
                    </span>
                  </button>
                ))}
              </div>

              {/* One field, both jobs: type to narrow the list, or paste a title
                  you half remember. Empty means "show me what is recent". */}
              <form
                className="mt-1 flex shrink-0 items-center gap-1.5 border-t border-white/10 pt-1.5"
                onSubmit={event => event.preventDefault()}
              >
                <input
                  className="min-w-0 flex-1 bg-transparent px-1 text-xs text-white/90 outline-none placeholder:text-white/30"
                  onChange={event => setQuery(event.target.value)}
                  onFocus={event => focusIsland(event.currentTarget)}
                  onPointerDown={event => focusIsland(event.currentTarget)}
                  placeholder={t.island.searchSessions}
                  value={query}
                />
              </form>
            </div>
          ) : null}

          {stage === 'session' ? (
            /* The main session view, mounted rather than imitated: same
               transcript, same thinking blocks, same tool grouping and
               auto-collapse, same running-tool decoration. A second renderer is
               what this used to be — and a second renderer drifts.

               Two things are taken away, and only these two: the pane's own
               rounded background (the island IS the surface, and a second card
               inside it reads as a widget someone forgot to finish) and the
               composer, which stays hidden until the pointer or the keyboard is
               in the panel. */
            <>
              <style>{`
                [data-island-chat] > * { background: transparent !important; border-radius: 0 !important; box-shadow: none !important; }
                [data-island-chat] [data-slot='composer-dock'] { opacity: 0; transition: opacity 140ms ease-out; }
                [data-island-chat]:hover [data-slot='composer-dock'],
                [data-island-chat] [data-slot='composer-dock']:focus-within { opacity: 1; }
              `}</style>
              <div className="relative mt-1.5 min-h-0 flex-1 overflow-hidden" data-island-chat="">
                <WiredPane part="chatRoutes" />
                {/* Bottom-right grip. The size is written once, on release, so a
                    drag repaints the surface and does not touch the settings file
                    sixty times a second. */}
                <div
                  className="absolute bottom-0 right-0 size-4 cursor-nwse-resize"
                  data-island-resize=""
                  onPointerDown={event => {
                    event.preventDefault()
                    event.stopPropagation()
                    event.currentTarget.setPointerCapture(event.pointerId)
                    gripRef.current = {
                      height: shape.height,
                      startX: event.screenX,
                      startY: event.screenY,
                      width: shape.width
                    }
                  }}
                  onPointerMove={event => {
                    const from = gripRef.current

                    if (!from) {
                      return
                    }

                    const size = {
                      height: limitSize(from.height + event.screenY - from.startY, 260, 546),
                      width: limitSize(from.width + event.screenX - from.startX, 340, 478)
                    }

                    gripPending.current = size
                    setLiveSize(size)
                  }}
                  onPointerUp={() => {
                    const size = gripPending.current
                    gripRef.current = null
                    gripPending.current = null

                    if (size) {
                      void saveIslandSettings({ sessionSize: size })
                    }

                    setLiveSize(null)
                  }}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
