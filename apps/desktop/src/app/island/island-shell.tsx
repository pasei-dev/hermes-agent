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
//   pill       — something is running: a dot, and one line — the session, its
//                tool and the buttons — that widens sideways on hover. It is
//                never taller than the housing, and it never opens the list.
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

import { SessionStatusDot } from '@/app/chat/session-status-dot'
import { WiredPane } from '@/app/contrib/wiring'
import { sessionRoute } from '@/app/routes'
import { MessageTextContent } from '@/components/assistant-ui/markdown-text'
import { Button } from '@/components/ui/button'
import { isRtlLocale, useI18n } from '@/i18n'
import { AlertTriangle, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, X } from '@/lib/icons'
import { sessionProjectLabel } from '@/lib/session-project-label'
import { cn } from '@/lib/utils'
import { $busyInputConfig } from '@/store/busy-input-mode'
import { $clarifyRequests, RECOMMENDED_LABEL } from '@/store/clarify'
import { $queuedPromptsBySession } from '@/store/composer-queue'
import { $gateway } from '@/store/gateway'
import { $island, saveIslandSettings } from '@/store/island'
import { $projects } from '@/store/projects'
import { sessionApprovalStackSize } from '@/store/prompts'
import { $sessions, sessionMatchesStoredId } from '@/store/session'
import { $attentionSessionIds, $sessionStates, $workingSessionIds } from '@/store/session-states'
import { $unreadFinishedMarkers, ackStoredSessionId } from '@/store/session-unread'
import type { SessionInfo } from '@/types/hermes'

import { islandQueueView } from './island-actions'
import { $islandActivityBySession, type IslandActivity } from './island-activity'
import { useIslandClickThrough } from './island-click-through'
import { islandAnsweredNotice, type IslandRow, islandRows, type IslandStage, islandStage } from './island-model'
import {
  type IslandTranscriptRow,
  readIslandTranscript,
  submitToIslandSession
} from './island-session'
import { islandPrefersReducedMotion, islandSettleTransform, useIslandSettle } from './island-settle'
import { springShapeKeyframes, springShapeRest } from './island-spring'
import {
  GOO_BLEED,
  islandClipPath,
  islandContentInset,
  islandCorners,
  type IslandDockSide,
  islandDockSide,
  islandGooLayer,
  islandLeash,
  islandShape,
  islandSurfaceTransform,
  LEASH_BAND,
  NOTCH_HEIGHT,
  NOTCH_WIDTH
} from './island-view'
import { type IslandApprovalChoice, type IslandApprovalOptions, useIslandApprovals } from './use-island-approvals'

/** The animation currently painting each surface's box, so a retarget can read
 *  what is on screen before it replaces it. */
const springRail = new WeakMap<Element, Animation>()

/** macOS's own expansion curve — fast out, long settle. */
const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)'

/** A dragged size, kept inside the window's ceiling and above the size that
 *  still holds a header and a line of transcript. */
const limitSize = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)))
const MORPH = `margin-top 380ms ${SPRING}, opacity 200ms ease-out, transform 300ms ${SPRING}`
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

/** The gap the neck is replayed at when a surface docks home: taller than the
 *  housing, so a length of it shows below the notch before it closes. */
const ABSORB_GAP = 56
/** How close to the window's edges the session panel may grow: the housing band
 *  is unpainted and the panel is a card inside the rectangle, not the rectangle. */
const PANEL_MARGIN = 8
/** How the neck closes over a surface that has just landed in the housing. */
const GOO_CLOSE = 'height 260ms ease-out, opacity 200ms ease-out, transform 280ms cubic-bezier(0.32, 0.72, 0, 1)'

/**
 * The bot and the status counts animate themselves.
 *
 * A face that blinks while a turn runs says "alive" in a 32 px band, where a
 * colour cannot; CSS keeps that off the render path, and reduced motion turns all
 * of it off.
 */
const ISLAND_MOTION_CSS = `
  @keyframes island-bot-bob { 0%, 100% { transform: translateY(0.4px) } 50% { transform: translateY(-0.6px) } }
  @keyframes island-bot-eyes { 0%, 88%, 100% { transform: scaleY(1) } 92%, 96% { transform: scaleY(0.18) } }
  @keyframes island-status-ping { 0% { opacity: 0.55; transform: scale(1) } 70%, 100% { opacity: 0; transform: scale(2.6) } }
  [data-island-bot] svg { animation: island-bot-bob 2.6s ease-in-out infinite }
  [data-island-bot='attention'] [data-island-eye],
  [data-island-bot='working'] [data-island-eye] { animation: island-bot-eyes 3.4s ease-in-out infinite; transform-origin: center }
  [data-island-ping] { animation: island-status-ping 1.8s ease-out infinite }
  @media (prefers-reduced-motion: reduce) {
    [data-island-bot] svg, [data-island-bot] [data-island-eye], [data-island-ping] { animation: none }
    /* The neck closes in one step like everything else the motion setting
       governs, rather than easing shut. */
    [data-island-goo] { transition: none !important }
  }
`

/**
 * The bot that carries the pill: a face rather than a dot, because the only thing
 * that reads at a glance in a 32 px band is that something is alive. Its mood is
 * the strongest thing waiting — an error outranks a parked question, which
 * outranks work in flight.
 */
function IslandBot({ mood }: { mood: 'attention' | 'error' | 'idle' | 'working' }) {
  const eyes = mood === 'attention' ? 'fill-amber-300' : mood === 'error' ? 'fill-red-400' : 'fill-white/85'

  return (
    <span
      aria-hidden="true"
      className="relative flex size-4 shrink-0 items-center justify-center"
      data-island-bot={mood}
    >
      <svg className="size-4 overflow-visible" viewBox="0 0 16 16">
        {/* An aerial, so the face reads as a machine and not as a smiley. */}
        <path className="stroke-white/40" d="M8 1.4V3.4" strokeLinecap="round" strokeWidth="1" />
        <circle className="fill-white/55" cx="8" cy="1.2" r="1" />
        <rect className="fill-white/12 stroke-white/30" height="10.4" rx="3.8" strokeWidth="1" width="13.6" x="1.2" y="3.6" />
        <circle className={eyes} cx="5.7" cy="8.7" data-island-eye="" r="1.3" />
        <circle className={eyes} cx="10.3" cy="8.7" data-island-eye="" r="1.3" />
      </svg>
    </span>
  )
}

/** Whether the window's top edge is on the screen's. A notched island window is
 *  created flush with it and a drag off the notch moves the window, so this is the
 *  renderer's own answer to "is the surface still the housing?" — the one fact it
 *  can read without main telling it. */
function islandOnEdge(): boolean {
  return Math.abs(window.screenY) <= 1
}

function islandNotched(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('notch') === '1'
  } catch {
    return false
  }
}

/** The housing's width on this display, as main derived it from the menu bar. */
function islandNotchWidth(): number | undefined {
  try {
    const raw = Number(new URLSearchParams(window.location.search).get('nw'))

    return Number.isFinite(raw) && raw > 0 ? raw : undefined
  } catch {
    return undefined
  }
}

/** The housing's height on this display, as main measured it: the menu bar is the
 *  notch, and its height moves with the display's scaling. */
function islandNotchHeight(): number {
  try {
    const raw = Number(new URLSearchParams(window.location.search).get('nh'))

    // The housing's point size follows the display's scale (185x32 at a 2x menu
    // bar, 220x38 at a wider one), so the measured height is used as it is and
    // only bounded against nonsense.
    return Number.isFinite(raw) && raw > 0 ? Math.min(40, Math.max(24, raw)) : NOTCH_HEIGHT
  } catch {
    return NOTCH_HEIGHT
  }
}

export function IslandShell() {
  const { locale, t } = useI18n()
  const navigate = useNavigate()
  const rtl = isRtlLocale(locale)
  const notched = useMemo(islandNotched, [])
  const notchHeight = useMemo(islandNotchHeight, [])
  const notchWidth = useMemo(islandNotchWidth, [])
  const sessions = useStore($sessions)
  const attentionIds = useStore($attentionSessionIds)
  const workingIds = useStore($workingSessionIds)

  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<null | string>(null)
  /** True between the pointer travelling and the release: no CSS transition runs
   *  while the window itself is moving, or every frame re-rasterises the text. */
  const [dragging, setDragging] = useState(false)
  /** At rest the pill is a dot; the line and the width appear under the pointer.
   *  Hover is a widening, never an expansion: it says what is running and offers
   *  the buttons, and the list still waits for a click. */
  const [hovered, setHovered] = useState(false)
  /** How far the surface has been let out of the housing WITHOUT the window
   *  moving: the leash's own lag, painted as a translate on the surface with the
   *  goo neck bridging the gap it leaves. Zero once the leash is cut. */
  const [leash, setLeash] = useState(0)
  /** Whether the surface is still holding the housing edge, which is what makes
   *  a drag a pull-away rather than a move. Main re-announces the dock after it
   *  settles, so this tracks the truth rather than the renderer's guess. */
  const attachedRef = useRef(true)
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
  const [dock, setDock] = useState<IslandDockSide>(notched ? 'top' : 'free')
  /** Whether the surface is the housing at the top of a notched display. Off that
   *  edge it is a capsule pill, and nothing reserves the cutout's band above its
   *  content. Seeded from where main creates the window: flush with the top edge
   *  on a display that has a housing, 8 px under the menu bar where it has none. */
  const [attached, setAttached] = useState(notched)
  /** The neck being re-absorbed after the surface docks home, as a gap in px. */
  const [absorb, setAbsorb] = useState(0)
  /** Whether the surface has been pulled off the edge since it was last pressed:
   *  a dock announcement at home then lands a surface that was away, which is the
   *  one time the neck is replayed. Written from the gesture only. */
  const tornRef = useRef(false)
  // The app window has the keyboard. The island is a notification, not a HUD:
  // while the user is reading Hermes itself it goes back into the notch.
  const [mainFocused, setMainFocused] = useState(false)

  /** Main's dock announcement follows every settle, so it is also the moment the
   *  window has finished moving — the only honest instant to ask whether the
   *  surface landed back on the edge. */
  const readHome = useCallback((side?: IslandDockSide) => {
    requestAnimationFrame(() => {
      // Main names the edge the surface settled on, so the answer comes from the
      // window's own dock rather than from where its top happens to be: a
      // notched display that is not the main one sits at bounds.y > 0, and the
      // screen-edge test reads that as detached while the surface is in the
      // housing. The test is only the fallback for a paint that beat the first
      // announcement.
      const home = side ? side === 'top' : islandOnEdge()
      setAttached(home)

      // Coming home: the neck it was pulled out of closes over it, once.
      if (home && tornRef.current) {
        tornRef.current = false
        setAbsorb(ABSORB_GAP)
      }
    })
  }, [])

  useEffect(() => {
    const offDock = window.hermesDesktop?.island?.onDock?.(raw => {
      const side = islandDockSide(raw)
      setDock(side)
      readHome(side)
    })

    const offFocus = window.hermesDesktop?.island?.onMainFocus?.(setMainFocused)

    return () => {
      offDock?.()
      offFocus?.()
    }
  }, [readHome])

  // The neck is one transition, not a frame loop: it is armed here, and closes
  // the moment this clears — the hold is only long enough to be seen.
  useEffect(() => {
    if (!absorb) {
      return
    }

    const timer = setTimeout(() => setAbsorb(0), 90)

    return () => clearTimeout(timer)
  }, [absorb])

  const rootRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const tailRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<null | { moved: boolean; startX: number; startY: number; travel: number; x: number; y: number }>(null)

  const { approvalsById, answer } = useIslandApprovals(attentionIds)
  const projectList = useStore($projects)
  const { offset: settleOffset, settle } = useIslandSettle()

  // One row lookup behind all three per-row facts: the title, the project and
  // the session the status dot colors itself from. Attention/working ids are
  // stored ids already (lineage-expanded), so the app's own matcher resolves
  // them; the project goes through the SIDEBAR's resolver (`sessionProjectLabel`)
  // so the island cannot name a row differently from the list beside it.
  const meta = useMemo(() => {
    const byId: Record<string, SessionInfo> = {}
    const projects: Record<string, string> = {}
    const titles: Record<string, string> = {}

    for (const id of [...attentionIds, ...workingIds]) {
      const session = sessions.find(row => sessionMatchesStoredId(row, id))

      if (!session) {
        continue
      }

      byId[id] = session

      if (session.title) {
        titles[id] = session.title
      }

      const project = sessionProjectLabel(session, projectList)

      if (project) {
        projects[id] = project
      }
    }

    return { projects, sessions: byId, titles }
  }, [attentionIds, projectList, sessions, workingIds])

  const { projects, sessions: sessionsById, titles } = meta

  const rows = useMemo(
    () => islandRows({ approvalsById, attentionIds, projects, titles, workingIds }),
    [approvalsById, attentionIds, projects, titles, workingIds]
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
  const markers = useMemo(() => Object.values(unread).flat(), [unread])

  const answeredId =
    top || waitingRows.length > 0
      ? null
      : islandAnsweredNotice({
          dismissed: dismissedAnswerId,
          markerIds: markers,
          rowIds: rows.map(row => row.id)
        })

  // A dismissal is only good for the marker it was made against. Once that
  // marker is gone the notice is re-armed, so the same session finishing again
  // shows its card instead of being silenced forever by an old dismissal.
  useEffect(() => {
    if (dismissedAnswerId && !markers.includes(dismissedAnswerId)) {
      setDismissedAnswerId(null)
    }
  }, [dismissedAnswerId, markers])

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
  // The notice opens its own answer in place: the island already fetched the
  // text, and "open Hermes to read it" is a journey for three paragraphs.
  const [answerOpen, setAnswerOpen] = useState(false)

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

    // Reading it is the opposite of dismissing it: an expanded answer holds the
    // card open until it is clicked away or the island loses focus.
    if (answerOpen) {
      return
    }

    // Six seconds: long enough to read one line, short enough that the island is
    // gone before the user looks up. Focused, there is nothing to tell them —
    // they are reading the app itself — so it clears at once.
    const timer = setTimeout(
      () => {
        setDismissedAnswerId(answeredId)
        ackStoredSessionId(answeredId)
      },
      mainFocused ? 0 : 6_000
    )

    return () => clearTimeout(timer)
  }, [answeredId, answerOpen, mainFocused])

  // A new notice always starts folded.
  useEffect(() => {
    setAnswerOpen(false)
  }, [answeredId])

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
  // The session the header dot speaks for: the one open in place, else the pill's lead.
  const headSessionId = (focused ?? lead)?.id ?? null

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
  /** The island window's own size, as main announces it (on create, on every
   *  resize, on a display change). It is the ceiling on every stage, so the
   *  panel may not exceed it — before the first announcement it is the size main
   *  opens at. */
  const [windowSize, setWindowSize] = useState({ height: 820, width: 600 })

  /** What the panel may occupy inside that window, leaving its edges breathing
   *  room and the housing band unpainted. */
  const panelMax = useMemo(
    () => ({
      height: Math.max(240, windowSize.height - (notched ? notchHeight : 0) - PANEL_MARGIN * 2),
      width: Math.max(320, windowSize.width - PANEL_MARGIN * 2)
    }),
    [notched, notchHeight, windowSize.height, windowSize.width]
  )

  // A remembered size is clamped to the window it is drawn in: the user may have
  // sized the panel before the window could grow, and a stale size that exceeds
  // it is clipped with no error.
  const remembered = islandPrefs.sessionSize

  const sessionSize =
    liveSize ??
    (remembered
      ? {
          height: Math.min(remembered.height, panelMax.height),
          width: Math.min(remembered.width, panelMax.width)
        }
      : panelMax)

  /** Ask main for a window that fits this panel. One request per frame: a
   *  `setBounds` per pointer event is the synchronous compositor round trip the
   *  island's fixed-rectangle design exists to avoid. Main clamps and applies
   *  it, then announces the size back. */
  const resizeFrame = useRef(0)

  const requestWindowSize = useCallback(
    (size: { height: number; width: number }) => {
      if (resizeFrame.current) {
        return
      }

      resizeFrame.current = requestAnimationFrame(() => {
        resizeFrame.current = 0
        window.hermesDesktop?.island?.resize?.({
          height: size.height + (notched ? notchHeight : 0) + PANEL_MARGIN * 2,
          width: size.width + PANEL_MARGIN * 2
        })
      })
    },
    [notched, notchHeight]
  )

  useEffect(() => {
    return window.hermesDesktop?.island?.onBounds?.(size => {
      if (size.width > 0 && size.height > 0) {
        setWindowSize(size)
      }
    })
  }, [])

  // The surface stops being the housing the moment it is let out of it: below the
  // housing's own height the shape is a capsule and the neck painted behind it
  // carries the join, so the pull reads as liquid leaving the notch.
  const tearing = dragging && leash > 1
  const housing = notched && attached && !tearing
  /** How far the surface has been let out of the housing, in px. Only a tear has
   *  a neck: a detached pill is carried as a plain move, and a surface that has
   *  just docked home replays it once as it is absorbed. */
  const gap = tearing ? Math.max(0, leash) : housing ? absorb : 0

  const shape = islandShape({
    attached: attached && !tearing,
    // A card that carries a question is taller: two lines of it, up to three
    // answers, and the field. Sized from the kind, so nothing is drawn past the
    // surface's own bottom edge.
    cardHeight: question ? 184 : answered ? (answerOpen ? 300 : 120) : 104,
    notchHeight,
    notchWidth,
    notched,
    // Nothing running, nothing waiting: the pill is the notch itself. Hover
    // widens it into the wings either side of the housing for one line — the
    // session, its tool, the status counts and the buttons — so the island stops
    // being a strip of text on top of whatever the user is doing without ever
    // growing taller. A dragged pill does not widen: the pointer is pulling it,
    // not reading it.
    rich: stage === 'pill' && hovered && !dragging,
    rows: stage === 'session' ? transcript.length : rows.length,
    sessionSize,
    stage
  })

  // The shape follows its target directly: `island-spring.ts` carries the
  // velocity a retarget needs, and its host has to survive a render per frame.
  const target = useMemo(
    () => ({ height: shape.height, radius: shape.radius, width: shape.width }),
    [shape.height, shape.radius, shape.width]
  )

  const box = target

  // The neck's numbers are computed from the live gap rather than eased: they
  // follow the finger, and only the closing one runs through a CSS transition.
  const goo = islandGooLayer({ gap, notchHeight, surface: box.width })

  // The box moves on a spring, not a curve: the whole trajectory is integrated
  // once (island-spring.ts) and painted by one element animation, so a stage
  // change overshoots and settles the way the reference notch apps do — and a
  // change that interrupts another starts from what is on screen.
  useEffect(() => {
    const surfaceEl = surfaceRef.current

    if (!surfaceEl || islandPrefersReducedMotion()) {
      return
    }

    // Read BEFORE cancelling: the running animation is what the eye sees, and it
    // is the only honest starting point for a change that interrupts another.
    const painted = surfaceEl.getBoundingClientRect()
    springRail.get(surfaceEl)?.cancel()

    const from = springShapeRest({ height: painted.height, radius: box.radius, width: painted.width })
    const { duration, frames } = springShapeKeyframes(from, target)
    const animation = surfaceEl.animate(frames, { duration, easing: 'linear', fill: 'none' })

    springRail.set(surfaceEl, animation)
  }, [box.radius, target])

  // Collapsed with something running and nothing waiting: the pill's only job is
  // the dot and the line, so its buttons wait for the pointer. A pill pulled off
  // the edge of a notched display has no housing over it and keeps its line, and
  // its buttons, all the time.
  const carriesLine = stage === 'pill' && notched && !attached
  const atRest = stage === 'pill' && !carriesLine

  /** The middle of the band is the opaque camera housing, so a row painted there
   *  is invisible: the wings either side are all a hover has to work with. */
  const blocked = housing && stage === 'pill'
  const housingWidth = Math.round(notchWidth ?? NOTCH_WIDTH)

  // What the wings count: work in flight, a session parked on the user, a turn
  // that finished while they were elsewhere, and anything the island failed to do.
  const counts = useMemo(
    () => ({
      error: error || transcriptError ? 1 : 0,
      finished: markers.length,
      running: runningCount,
      waiting: waitingRows.length
    }),
    [error, markers.length, runningCount, transcriptError, waitingRows.length]
  )

  const mood = counts.error > 0 ? 'error' : counts.waiting > 0 ? 'attention' : counts.running > 0 ? 'working' : 'idle'

  useIslandClickThrough(rootRef)

  // A character typed into the open list is a search. The field appears WITH
  // that character in it, which is how a field that is hidden until typing can
  // be reached by typing alone.
  useEffect(() => {
    if (stage !== 'expanded' || query) {
      return
    }

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null

      // The composer and the deny reason own their own typing.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1 || !event.key.trim()) {
        return
      }

      window.hermesDesktop?.island?.setFocusable?.(true)
      setQuery(event.key)
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [query, stage])

  const searching = query.length > 0

  // Matches the title and the project, so a row is found by either half of what
  // it shows. The filter never touches the geometry: the island is sized from
  // the unfiltered list so typing cannot grow or shrink it under the pointer.
  const shownRows = searching
    ? rows.filter(row => `${row.title} ${row.project ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    : rows

  // Where the pill sits inside the window, measured rather than derived: the
  // shape changes per stage and mid-animation, so a number calculated here would
  // drift from the CSS the user is looking at. Main clamps and snaps this rect.
  const reportSurface = useCallback(() => {
    const surfaceEl = surfaceRef.current

    if (!surfaceEl) {
      return
    }

    // Layout, not paint: `getBoundingClientRect` includes the drag's scale and the
    // settle spring, so a re-measure mid-gesture would hand main a phantom rect.
    window.hermesDesktop?.island?.surface?.({
      height: surfaceEl.offsetHeight,
      offsetX: surfaceEl.offsetLeft,
      offsetY: surfaceEl.offsetTop,
      width: surfaceEl.offsetWidth
    })
  }, [])

  useEffect(() => {
    reportSurface()
  }, [reportSurface, shape.height, shape.width])

  // The window is snapped by main in one jump; the pill springs from where the
  // pointer asked for into where it settled, so the jump reads as a settle.
  useEffect(() => {
    return window.hermesDesktop?.island?.onRemeasure?.(() => reportSurface())
  }, [reportSurface])

  // The gesture's own state, cleared when main settles it.
  const clearDrag = useCallback(() => {
    dragRef.current = null
    setDragging(false)
    setLeash(0)
  }, [])

  // Main's release message is the correction it applied to the window. The
  // surface paints that correction for one frame and springs to rest, so a
  // snapped window lands instead of teleporting — `island-settle.ts` owns it.
  useEffect(() => {
    return window.hermesDesktop?.island?.onSettle?.(correction => {
      // Main settles a gesture a third of a second after the last move, and the
      // renderer's own pointerup is lost whenever the window has moved out from
      // under the cursor. Left open, a gesture keeps its lift and its stretch
      // painted forever — a pill frozen mid-drag that no longer reacts to shape.
      clearDrag()
      settle(correction)
    })
  }, [clearDrag, settle])

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
      setQuery('')
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

  // Looking away is the same instruction as a click elsewhere: the island closes
  // what it opened for you and gives the keyboard back.
  const collapse = useCallback(() => {
    setExpanded(false)
    setFocused(null)
    setTranscript([])
    setAnswerOpen(false)
    // An invisible filter that survives the close swallows the next Escape and
    // makes the next list look empty for no visible reason.
    setQuery('')
  }, [])

  const onSurfaceBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget as Node | null

      if (!next || !event.currentTarget.contains(next)) {
        window.hermesDesktop?.island?.setFocusable?.(false)
        collapse()
      }
    },
    [collapse]
  )

  // No focus to lose in the pidgin stages (the window is not focusable), so the
  // pointer leaving is the equivalent signal. A grace period keeps a diagonal
  // pass over the pill from closing it.
  const leaveTimer = useRef<null | ReturnType<typeof setTimeout>>(null)

  const onPointerLeaveSurface = useCallback(() => {
    setHovered(false)

    // The open session takes the keyboard, so it closes on blur instead: a
    // pointer that wanders off while you read is not a request to close it.
    if (focused) {
      return
    }

    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current)
    }

    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null
      collapse()
    }, 1200)
  }, [collapse, focused])

  // Hovering is asking what is going on, and the answer is one line: the session,
  // the tool it is in, and the buttons. It never opens the list — a surface that
  // unfolds under a passing pointer takes the screen from whatever the user was
  // reading — so the list stays a click away and nothing else here runs on a timer.
  const onPointerEnterSurface = useCallback(() => {
    setHovered(true)

    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
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
      // Whether this press is a pull on the housing edge is a fact about where
      // the surface sits right now, not about what main last announced: flush
      // with the top of the screen means attached, anything else is a move.
      const rect = surfaceRef.current?.getBoundingClientRect()
      attachedRef.current = rect ? Math.abs(window.screenY + rect.top) <= 1 : true
      // A surface pressed away from the edge has nothing to tear off, and the neck
      // is only replayed for one that was pulled out of the housing.
      tornRef.current = !attachedRef.current
      setAttached(attachedRef.current)
      dragRef.current = { moved: false, startX: event.screenX, startY: event.screenY, travel: 0, x: event.screenX, y: event.screenY }
      event.currentTarget.setPointerCapture(event.pointerId)
      // Main clamps the pill, not the window: it needs the pill's rect before
      // the first delta, not after it.
      reportSurface()
    },
    [reportSurface]
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

      // The leash: the surface's travel away from the notch is NOT the pointer's.
      // While it is attached the window HOLDS and that travel is painted inside it,
      // so the surface is let out of the housing by the lag — down the goo neck —
      // instead of the whole window moving. Past the band the leash is cut, the
      // held lag goes to main with this same move (so the place on the glass does
      // not jump), and the surface then tracks the pointer one for one.
      const travel = from.travel + dy
      // Only a surface still holding the edge may leashe: once it has been let
      // go, dragging the parked pill is a plain move of a plain pill, and
      // replaying the stretch-and-cut on every grab of it is the bug.
      const attached = attachedRef.current && Math.abs(travel) <= LEASH_BAND
      const cut = attachedRef.current && !attached
      const held = cut ? islandLeash(from.travel) : 0

      if (cut) {
        attachedRef.current = false
        // Torn free: from here the surface is a capsule carried by the pointer,
        // and the neck it left behind is only replayed when it docks home.
        tornRef.current = true
        setAttached(false)
      }

      from.travel = travel
      from.x = event.screenX
      from.y = event.screenY
      setLeash(attached ? islandLeash(travel) : 0)
      window.hermesDesktop?.island?.drag?.({ dx, dy: attached ? 0 : dy + held })
    },
    []
  )

  const cancelDrag = useCallback(() => {
    dragRef.current = null
    setDragging(false)
    setLeash(0)
  }, [])

  // The surface is the expand control: a press that stayed put was a click.
  const endDrag = useCallback(() => {
    const from = dragRef.current
    dragRef.current = null
    setDragging(false)
    setLeash(0)

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

      // The search is the shallowest thing on screen: it goes first, and the
      // list collapses on the next Escape.
      if (query) {
        setQuery('')

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
  }, [expanded, focused, query, stage])

  const content = stage !== 'hidden'
  // The neck snaps while it is being dragged — it follows the finger — and closes
  // through one transition on the way back into the housing.
  const gooSnaps = dragging || absorb === ABSORB_GAP
  // The edge the corners square against. Only a surface that IS the housing is
  // flush with the top of the screen: a pill that has been let out of it keeps
  // all four corners, whatever main last announced.
  const cornerSide: IslandDockSide = shape.bottomOnly ? 'top' : !housing && dock === 'top' ? 'free' : dock

  return (
    <div
      className="relative flex h-screen w-screen items-start justify-center overflow-hidden"
      dir={rtl ? 'rtl' : 'ltr'}
      onBlur={onSurfaceBlur}
      ref={rootRef}
      style={{
        justifyContent: dock === 'left' ? 'flex-start' : dock === 'right' ? 'flex-end' : 'center',
        paddingTop: notched || dock === 'top' ? 0 : 8
      }}
    >
      <style>{ISLAND_MOTION_CSS}</style>
      {/* The neck is a SILHOUETTE layer, never a wrapper: the filter's alpha
          threshold eats glyphs, so the crisp surface and then the content are
          painted on top of it and only this black shape is blurred and
          re-thresholded. It is pinned to the screen's top edge, which is where
          the housing is, and its tapered end is bled under the surface. */}
      {notched ? (
        <>
          <svg aria-hidden="true" className="pointer-events-none absolute size-0">
            <filter colorInterpolationFilters="sRGB" height="140%" id="island-goo" width="140%" x="-20%" y="-20%">
              <feGaussianBlur in="SourceGraphic" result="goo" stdDeviation={goo?.blur ?? 0} />
              <feColorMatrix in="goo" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" />
            </filter>
          </svg>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-1/2"
            data-island-goo=""
            style={{
              filter: 'url(#island-goo)',
              height: goo?.height ?? GOO_BLEED,
              opacity: goo ? 1 : 0,
              transform: `translateX(-50%) scaleY(${goo ? 1 : 0})`,
              transformOrigin: 'top center',
              transition: gooSnaps ? 'none' : GOO_CLOSE,
              width: goo?.width ?? 0,
              zIndex: 0
            }}
          >
            {/* Clipped BEFORE the filter: a clip on the filtered element would cut
                off the fillets the blur just made. */}
            <div className="size-full bg-black" style={{ clipPath: goo?.clip }} />
          </div>
        </>
      ) : null}
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
        onPointerEnter={onPointerEnterSurface}
        onPointerLeave={onPointerLeaveSurface}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        ref={surfaceRef}
        style={{
          // A notch surface is clipped instead: its top corners flare outward
          // into the screen's edge, which no radius can express.
          clipPath: islandClipPath(shape) ?? undefined,
          // A docked island squares the corners against its edge: a capsule
          // floating 30px from the screen edge is not attached to it.
          borderRadius: islandCorners(box.radius, cornerSide),
          cursor: focused ? undefined : notched ? 'pointer' : 'grab',
          height: shape.height,
          // A notched surface is an extrusion of the housing, not a pill below it:
          // flush with the screen's top edge, and the housing's height is taken as
          // padding inside instead (see the content box).
          marginTop: notched ? 0 : shape.top,
          opacity: shape.opacity,
          // One transform, in priority order: the drag's lift while the gesture is
          // live, the release's correction on the frame after it, the resting
          // pose otherwise. A hidden surface rests scaled down, so its fade reads
          // as a retreat.
          transform: islandSurfaceTransform({
            dragging,
            // The tear, as the surface's own travel out of the housing. A
            // transform rather than a layout offset: `reportSurface` measures
            // layout, and a pill that moved its own box would hand main a phantom
            // rect to clamp against.
            paint: dragging && gap > 0 ? `translateY(${Math.round(gap)}px)` : '',
            settle: settleOffset ? islandSettleTransform(settleOffset) : null,
            visible: shape.opacity !== 0
          }),
          transformOrigin: 'top center',
          // Size is the spring's; only colour and opacity keep a CSS transition.
          transition: settleOffset || dragging ? 'none' : REVEAL,
          width: box.width,
          // The silhouette paints under the surface, whatever the surface's own
          // transform does to its stacking context.
          zIndex: 1
        }}
      >
        <div
          className="flex h-full flex-col px-2.5 pb-2"
          style={{
            opacity: content ? 1 : 0,
            // Hidden means nothing paints, not merely transparent: a status dot
            // left at zero opacity is still a lit pixel or two in the notch.
            visibility: content ? 'visible' : 'hidden',
            // Under the housing the content starts below it; off that edge it
            // starts at the surface's own padding, with no blank line above it.
            paddingTop: islandContentInset(shape),
            transform: content ? 'none' : 'translateY(-6px)',
            transition: REVEAL
          }}
        >
          <div className="flex h-6 shrink-0 items-center gap-1.5">
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
            <IslandBot mood={mood} />
            {/* The sidebar's 6px dot is a row marker beside a label; alone in a
                32px band beside an opaque housing it is a speck. Same dot, one
                size up, so the resting pill still says something is running —
                and it is the only mark that names the lead session's own state. */}
            {headSessionId ? (
              <span className="flex items-center [&_span]:size-2">
                <SessionStatusDot session={sessionsById[headSessionId] ?? null} storedSessionId={headSessionId} />
              </span>
            ) : (
              <span className={cn(DOT, 'bg-white/30')} />
            )}
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
            {/* The middle of the band is the opaque camera housing, so the wings
                either side are all a hover has to work with: reserving its width
                keeps nothing the user must read behind the cutout. */}
            {blocked ? <span aria-hidden="true" className="shrink-0" style={{ width: housingWidth }} /> : null}
            {/* What is running, what is parked on the user, what finished while
                they were elsewhere, and what failed: totals, in the right wing. */}
            <div className="flex shrink-0 items-center gap-1.5" data-island-counts="">
              {counts.waiting > 0 ? (
                <span
                  className="flex shrink-0 items-center gap-0.5 text-[0.6rem] tabular-nums text-amber-300/90"
                  title={t.island.waiting(counts.waiting)}
                >
                  <span className="size-1.5 rounded-full bg-amber-400" />
                  {counts.waiting}
                </span>
              ) : null}
              {counts.running > 0 ? (
                <span
                  className="flex shrink-0 items-center gap-0.5 text-[0.6rem] tabular-nums text-white/65"
                  title={t.island.running(counts.running)}
                >
                  <span className="relative flex size-1.5 items-center justify-center">
                    <span className="absolute inset-0 rounded-full bg-(--ui-accent)" data-island-ping="" />
                    <span className="size-1.5 rounded-full bg-(--ui-accent)" />
                  </span>
                  {counts.running}
                </span>
              ) : null}
              {counts.finished > 0 ? (
                <span
                  className="flex shrink-0 items-center gap-0.5 text-[0.6rem] tabular-nums text-emerald-300/90"
                  title={t.island.finished}
                >
                  <Check className="size-3" />
                  {counts.finished}
                </span>
              ) : null}
              {counts.error > 0 ? (
                <span
                  className="flex shrink-0 items-center text-red-400"
                  title={error ?? transcriptError ?? t.island.needsInput}
                >
                  <AlertTriangle className="size-3" />
                </span>
              ) : null}
            </div>
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
                   "what did it say" without opening anything. A click expands
                   it to the whole answer, rendered by the same pipeline the
                   transcript uses — headings, lists and code survive. */
                answerOpen ? (
                  <div
                    className="mt-1 min-h-0 flex-1 overflow-y-auto pr-1 text-[0.72rem] text-white/85"
                    data-island-answer=""
                  >
                    {answerPreview ? (
                      <MessageTextContent text={answerPreview} />
                    ) : (
                      <span className="text-white/60">{t.island.finished}</span>
                    )}
                  </div>
                ) : (
                  <button
                    className="mt-1 line-clamp-3 w-full text-left text-[0.72rem] text-white/80 hover:text-white"
                    onClick={() => setAnswerOpen(true)}
                    title={t.island.open}
                    type="button"
                  >
                    {answerPreview || t.island.finished}
                  </button>
                )
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
              <div className="relative min-h-0 flex-1">
                {/* The field appears with the first character already in it, and
                    covers the first row rather than taking a row of its own: the
                    island has room for rows or for a field, not both. */}
                {searching ? (
                  <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-1 rounded-lg bg-black/85 px-2 py-1 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.14)]">
                    <input
                      aria-label={t.island.search}
                      autoFocus
                      className="min-w-0 flex-1 bg-transparent px-1 text-xs text-white/90 outline-none"
                      data-island-search=""
                      onChange={event => setQuery(event.target.value)}
                      onFocus={event => focusIsland(event.currentTarget)}
                      onKeyDown={event => {
                        if (event.key === 'Escape') {
                          setQuery('')
                        }
                      }}
                      onPointerDown={event => focusIsland(event.currentTarget)}
                      value={query}
                    />
                    <Button
                      aria-label={t.island.collapse}
                      className={GLYPH}
                      onClick={() => setQuery('')}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <X />
                    </Button>
                  </div>
                ) : null}

                {/* The field floats over the list, so the list starts below it
                    while it is up: otherwise the first match is behind it and
                    unclickable. */}
                <div className="h-full overflow-y-auto" style={{ paddingTop: searching ? 30 : 0 }}>
                  {shownRows.length === 0 && recents.length === 0 ? (
                    <div className="px-2 py-1 text-[0.7rem] text-white/40">{t.island.empty}</div>
                  ) : null}
                  {shownRows.map(row => (
                    <button className={ROW} key={row.id} onClick={() => focusSession(row)} type="button">
                      <SessionStatusDot session={sessionsById[row.id]} storedSessionId={row.id} />
                      <span className="min-w-0 flex-1 truncate text-xs">{row.title || t.island.needsInput}</span>
                      {row.project ? (
                        <span
                          className="max-w-[6.5rem] shrink-0 truncate text-right text-[0.65rem] text-white/45"
                          data-island-project=""
                          title={row.project}
                        >
                          {row.project}
                        </span>
                      ) : null}
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
              </div>
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
                /* The island IS the surface: the theme's pane paints a second
                   card in another colour with its own radius. Every structural
                   container is flattened; inputs and buttons keep their paint. */
                [data-island-chat] > * { height: 100% !important; min-height: 0 !important; }
                [data-island-chat] div,
                [data-island-chat] section,
                [data-island-chat] main,
                [data-island-chat] aside,
                [data-island-chat] header,
                [data-island-chat] footer,
                [data-island-chat] article {
                  background: transparent !important;
                  border-radius: 0 !important;
                  box-shadow: none !important;
                }
                /* The composer is the one thing that must not be clipped: it
                   sits at the bottom of the pane, hidden until the panel is
                   looked at, and it takes no clicks while hidden — an invisible
                   band that swallows a press is worse than a visible one. */
                [data-island-chat] [data-slot='composer-dock'] {
                  opacity: 0;
                  pointer-events: none;
                  transform: translateY(6px);
                  transition: opacity 150ms ease-out, transform 150ms ease-out;
                }
                [data-island-chat]:hover [data-slot='composer-dock'],
                [data-island-chat] [data-slot='composer-dock']:focus-within {
                  opacity: 1;
                  pointer-events: auto;
                  transform: none;
                }
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
                      height: box.height,
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
                      height: limitSize(from.height + event.screenY - from.startY, 240, panelMax.height),
                      width: limitSize(from.width + event.screenX - from.startX, 320, panelMax.width)
                    }

                    gripPending.current = size
                    setLiveSize(size)
                    // The window grows with the panel: the window is the ceiling
                    // on every stage, so a panel that outgrew it would be
                    // clipped with no error.
                    requestWindowSize(size)
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
