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

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Square, X } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $busyInputConfig } from '@/store/busy-input-mode'
import { $queuedPromptsBySession } from '@/store/composer-queue'
import { $gateway } from '@/store/gateway'
import { sessionApprovalStackSize } from '@/store/prompts'
import { $sessions, sessionMatchesStoredId } from '@/store/session'
import { $attentionSessionIds, $sessionStates, $workingSessionIds } from '@/store/session-states'

import { cancelIslandQueuedPrompt, islandQueueView, stopIslandSession } from './island-actions'
import { $islandActivityBySession, formatIslandElapsed, type IslandActivity } from './island-activity'
import { useIslandClickThrough } from './island-click-through'
import { type IslandRow, islandRows, islandStage } from './island-model'
import {
  type IslandTranscriptRow,
  readIslandTranscript,
  submitToIslandSession
} from './island-session'
import { islandShape } from './island-view'
import { startIslandSession } from './start-session'
import { type IslandApprovalChoice, type IslandApprovalOptions, useIslandApprovals } from './use-island-approvals'

/** macOS's own expansion curve — fast out, long settle. */
const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)'
const MORPH = `width 380ms ${SPRING}, height 380ms ${SPRING}, border-radius 300ms ${SPRING}, opacity 200ms ease-out, transform 300ms ${SPRING}`
const REVEAL = `opacity 220ms ease-out 60ms, transform 320ms ${SPRING} 40ms`

const DOT = 'size-1.5 shrink-0 rounded-full'
const ROW = 'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-white/10'
const GLYPH = 'text-white/55 hover:text-white'

function islandNotched(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('notch') === '1'
  } catch {
    return false
  }
}

export function IslandShell() {
  const { t } = useI18n()
  const notched = useMemo(islandNotched, [])
  const sessions = useStore($sessions)
  const attentionIds = useStore($attentionSessionIds)
  const workingIds = useStore($workingSessionIds)

  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<null | string>(null)

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

  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dragRef = useRef<null | { x: number; y: number }>(null)

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

  const waitingRows = rows.filter(row => row.state === 'needs-input')
  // An actionable row wins the card: a session waiting on a clarify has nothing
  // to click but "Open", and letting it outrank the approval below it meant the
  // one card on screen could not be answered at all.
  const top = waitingRows.find(row => row.approval) ?? waitingRows[0]

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

  // A clock the pill can trust: `startedAt` anchors the number, and a local tick
  // is what turns it into text. Only while a turn is live — an idle island with a
  // timer running is a wakeup per second for nothing.
  const [clock, setClock] = useState(() => Date.now())

  // Any live turn keeps the clock running, not just the lead's: the expanded list
  // shows a per-row elapsed, and a frozen timer there would be a lie.
  const ticking = useMemo(() => Object.values(activities).some(entry => entry.startedAt), [activities])

  useEffect(() => {
    if (!ticking) {
      return
    }

    setClock(Date.now())
    const timer = setInterval(() => setClock(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [ticking])

  // Tool, elapsed, plan progress, workers — that reading order, and nothing at
  // all for a session that has none of them, so callers can fall back to a count.
  const describe = useCallback(
    (own: IslandActivity | undefined): string[] => {
      if (!own) {
        return []
      }

      const parts: string[] = []

      if (own.tool) {
        parts.push(own.tool)
      }

      if (own.startedAt) {
        parts.push(formatIslandElapsed(clock - own.startedAt))
      }

      if (own.todoTotal > 0) {
        parts.push(`${own.todoDone}/${own.todoTotal}`)
      }

      if (own.workers > 0) {
        parts.push(t.island.workers(own.workers))
      }

      return parts
    },
    [clock, t]
  )

  const activityParts = describe(activity)

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

  const stopTurn = useCallback(async () => {
    const gateway = $gateway.get()

    if (!gateway || !runtimeId) {
      return
    }

    setError(null)

    try {
      await stopIslandSession(
        (method, params) => gateway.request(method, params ?? {}) as Promise<never>,
        runtimeId
      )
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [runtimeId])

  const stage = islandStage({
    attentionCount: waitingRows.length,
    expanded,
    focused: focused !== null,
    workingCount: runningCount
  })

  const shape = islandShape({
    notched,
    rich: stage === 'pill' && activityParts.length > 0,
    rows: stage === 'session' ? transcript.length : rows.length,
    stage
  })

  useIslandClickThrough(rootRef)

  // Main holds the window hidden until this lands: the island is a full renderer,
  // so its first paint is the app's boot screen.
  useEffect(() => {
    window.hermesDesktop?.island?.ready?.()
  }, [])

  const openSession = useCallback((id: string) => {
    window.hermesDesktop?.island?.openSession?.(id)
    setExpanded(false)
    setFocused(null)
  }, [])

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
      setSessionDraft('')
      setTranscript([])
      setTranscriptError(null)
      void refreshTranscript(row.id)
    },
    [refreshTranscript]
  )

  useEffect(() => {
    if (stage !== 'session' || !focused) {
      return
    }

    const id = focused.id
    const timer = setInterval(() => void refreshTranscript(id), 3000)

    return () => clearInterval(timer)
  }, [focused, refreshTranscript, stage])

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

  const send = useCallback(async () => {
    if (!draft.trim() || sending) {
      return
    }

    setSending(true)
    setError(null)

    try {
      await startIslandSession(draft)
      setDraft('')
      setExpanded(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSending(false)
    }
  }, [draft, sending])

  // Dragging belongs to the displays without a housing: there the island is the
  // user's to park, and the window follows the pointer's own travel because the
  // renderer is the only side that sees the press.
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (notched || event.button !== 0) {
        return
      }

      if ((event.target as HTMLElement).closest('button, input, a')) {
        return
      }

      dragRef.current = { x: event.clientX, y: event.clientY }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [notched]
  )

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const from = dragRef.current

    if (!from) {
      return
    }

    window.hermesDesktop?.island?.drag?.({ dx: event.clientX - from.x, dy: event.clientY - from.y })
    dragRef.current = { x: event.clientX, y: event.clientY }
  }, [])

  const endDrag = useCallback(() => {
    dragRef.current = null
  }, [])

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
      onBlur={onSurfaceBlur}
      ref={rootRef}
      style={{ paddingTop: notched ? 0 : 8 }}
    >
      <div
        className={cn(
          'pointer-events-auto select-none overflow-hidden bg-black text-white/90',
          // A housing has no shadow: the pill sits in the notch, and a halo there
          // paints a grey smear across the menu bar either side of it.
          notched
            ? 'shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.07)]'
            : 'shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.07),0_18px_40px_-12px_rgba(0,0,0,0.7)]'
        )}
        data-island-mode={shape.mode}
        data-island-stage={stage}
        data-island-surface=""
        onPointerCancel={endDrag}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        style={{
          borderRadius: shape.radius,
          cursor: notched ? undefined : 'grab',
          height: shape.height,
          opacity: shape.opacity,
          transform: shape.opacity === 0 ? 'scale(0.92)' : 'none',
          transition: MORPH,
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
            <span className="min-w-0 flex-1 truncate text-xs">
              {focused
                ? focused.title || t.island.needsInput
                : waitingRows.length > 0
                  ? t.island.waiting(waitingRows.length)
                  : activityParts.length > 0
                    ? activityParts.join(' · ')
                    : t.island.running(runningCount)}
            </span>
            {liveTurn ? (
              <Button
                aria-label={t.island.stop}
                className={GLYPH}
                onClick={() => void stopTurn()}
                size="icon-xs"
                title={t.island.stop}
                variant="ghost"
              >
                <Square />
              </Button>
            ) : null}
            {queued && !focused ? (
              <span className="shrink-0 text-[0.65rem] text-white/35" title={queued.next}>
                {queued.count} {t.island.queued}
              </span>
            ) : null}
            {focused ? (
              <Button
                aria-label={t.island.open}
                className={GLYPH}
                onClick={() => openSession(focused.id)}
                size="icon-xs"
                title={t.island.open}
                variant="ghost"
              >
                <ArrowUpRight />
              </Button>
            ) : null}
            {top && !focused ? (
              <Button
                aria-label={t.island.open}
                className={GLYPH}
                onClick={() => openSession(top.id)}
                size="icon-xs"
                title={t.island.open}
                variant="ghost"
              >
                <ArrowUpRight />
              </Button>
            ) : null}
            {focused ? null : (
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

          {top ? (
            <div
              className="mt-1.5 shrink-0 rounded-xl bg-white/8 px-2 py-1.5 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.08)]"
              data-island-attention=""
            >
              <div className="truncate text-[0.7rem] text-white/55">{top.title || t.island.needsInput}</div>
              {top.approval ? (
                <div className="mt-1 line-clamp-2 font-mono text-[0.7rem] text-white/90">{top.approval.command}</div>
              ) : (
                <div className="mt-1 text-[0.7rem]">{t.island.needsInput}</div>
              )}
              <div className="mt-1.5 flex items-center gap-1.5">
                {top.approval ? (
                  denyFor === top.approval.requestId ? (
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
                        onClick={() => respond(top, 'deny', { reason: denyReason })}
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
                          setDenyFor(top.approval?.requestId ?? null)
                        }}
                        size="xs"
                        variant="outline"
                      >
                        {t.island.deny}
                      </Button>
                      <Button onClick={() => respond(top, 'once')} size="xs" variant="secondary">
                        {t.island.approve}
                      </Button>
                      <Button
                        className="text-white/70 hover:bg-white/10 hover:text-white"
                        onClick={() => respond(top, 'always')}
                        size="xs"
                        variant="ghost"
                      >
                        {t.island.always}
                      </Button>
                      {approvalDepth > 1 ? (
                        <Button
                          className="text-white/70 hover:bg-white/10 hover:text-white"
                          onClick={() => respond(top, 'once', { all: true })}
                          size="xs"
                          variant="ghost"
                        >
                          {t.island.approveAll}
                        </Button>
                      ) : null}
                    </>
                  )
                ) : (
                  <Button onClick={() => openSession(top.id)} size="xs" variant="secondary">
                    {t.island.open}
                  </Button>
                )}
              </div>
            </div>
          ) : null}

          {error ? <div className="mt-1.5 shrink-0 px-1 text-[0.7rem] text-red-400">{error}</div> : null}

          {stage === 'expanded' ? (
            <div className="mt-1.5 flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto">
                {rows.length === 0 ? (
                  <div className="px-2 py-1 text-[0.7rem] text-white/40">{t.island.empty}</div>
                ) : (
                  rows.map(row => (
                    <button className={ROW} key={row.id} onClick={() => focusSession(row)} type="button">
                      <span className={cn(DOT, row.state === 'needs-input' ? 'bg-amber-400' : 'bg-white')} />
                      <span className="min-w-0 flex-1 truncate text-xs">{row.title || t.island.needsInput}</span>
                      <span className="shrink-0 text-[0.65rem] text-white/35">
                        {row.state === 'needs-input'
                          ? t.island.needsAnswer
                          : describe(activities[row.id]).join(' · ') || t.island.working}
                      </span>
                    </button>
                  ))
                )}
              </div>

              <form
                className="mt-1 flex shrink-0 items-center gap-1.5 border-t border-white/10 pt-1.5"
                onSubmit={event => {
                  event.preventDefault()

                  if (!draft.trim()) {
                    focusIsland(inputRef.current)

                    return
                  }

                  void send()
                }}
              >
                <input
                  className="min-w-0 flex-1 bg-transparent px-1 text-xs text-white/90 outline-none placeholder:text-white/35"
                  onChange={event => setDraft(event.target.value)}
                  onFocus={event => focusIsland(event.currentTarget)}
                  // The window is non-activating, so a click may not focus the
                  // field by itself: ask for the keyboard on the press, which is
                  // the one gesture that means "I am about to type".
                  onPointerDown={event => focusIsland(event.currentTarget)}
                  placeholder={t.island.newSessionPlaceholder}
                  ref={inputRef}
                  value={draft}
                />
                <Button disabled={!draft.trim() || sending} size="xs" type="submit" variant="secondary">
                  {t.island.send}
                </Button>
              </form>
            </div>
          ) : null}

          {stage === 'session' ? (
            <div className="mt-1.5 flex min-h-0 flex-1 flex-col">
              {transcriptError ? (
                <div className="shrink-0 px-1 pb-1 text-[0.7rem] text-red-400">{transcriptError}</div>
              ) : null}

              <div className="min-h-0 flex-1 overflow-y-auto" data-island-transcript="">
                {transcript.length === 0 ? (
                  <div className="px-2 py-1 text-[0.7rem] text-white/40">{t.island.empty}</div>
                ) : (
                  transcript.map((line, index) => (
                    <div
                      className={cn(
                        'mb-1 line-clamp-2 rounded-lg px-2 py-1 text-[0.72rem] leading-snug',
                        line.role === 'user' ? 'bg-white/6 text-white/85' : 'text-white/60'
                      )}
                      data-island-line={line.role}
                      key={`${index}-${line.role}`}
                    >
                      {line.text}
                    </div>
                  ))
                )}
              </div>

              {queued ? (
                <div
                  className="mt-1 flex shrink-0 items-center gap-1.5 rounded-lg bg-white/6 px-2 py-1"
                  data-island-queue=""
                >
                  <span className="min-w-0 flex-1 truncate text-[0.68rem] text-white/55">
                    {queued.count} · {queued.next}
                  </span>
                  {queued.cancellable ? (
                    <Button
                      aria-label={t.island.cancelQueued}
                      className={GLYPH}
                      onClick={() => cancelIslandQueuedPrompt([runtimeId, focused?.id])}
                      size="icon-xs"
                      title={t.island.cancelQueued}
                      variant="ghost"
                    >
                      <X />
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <form
                className="mt-1 flex shrink-0 items-center gap-1.5 border-t border-white/10 pt-1.5"
                onSubmit={event => {
                  event.preventDefault()

                  if (!sessionDraft.trim()) {
                    focusIsland(inputRef.current)

                    return
                  }

                  void sendToSession()
                }}
              >
                <input
                  className="min-w-0 flex-1 bg-transparent px-1 text-xs text-white/90 outline-none"
                  onChange={event => setSessionDraft(event.target.value)}
                  onFocus={event => focusIsland(event.currentTarget)}
                  onPointerDown={event => focusIsland(event.currentTarget)}
                  ref={inputRef}
                  value={sessionDraft}
                />
                <Button disabled={!sessionDraft.trim() || sessionBusy} size="xs" type="submit" variant="secondary">
                  {liveTurn && busyMode === 'queue'
                    ? t.island.queueSend
                    : liveTurn && busyMode === 'steer'
                      ? t.island.steer
                      : t.island.send}
                </Button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
