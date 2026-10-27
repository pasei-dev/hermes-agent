// The Dynamic Island — the whole of it.
//
// A view over the app's stores, mounted by `ContribController` inside
// `<ContribWiring>`, which is what makes it a real part of the app rather than a
// second implementation: the gateway, the live session snapshot (1.5s
// `session.active_list`), the parked prompts and the send path are the same
// objects every other surface reads.
//
// Three stages, one surface:
//   pill      — something is running; a dot and a count.
//   attention — a turn is parked on the user. The island grows BY ITSELF (main
//               reveals it with `showInactive`, so the caret stays in the app
//               the user is in) and puts Deny/Approve one click away.
//   expanded  — the running list plus a quick-start field.
// With nothing running the window is hidden outright, which is the whole
// "no footprint when idle" half of the contract.
import { useStore } from '@nanostores/react'
import { type FocusEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { ArrowUpRight, ChevronDown, ChevronRight } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $sessions, sessionMatchesStoredId } from '@/store/session'
import { $attentionSessionIds, $workingSessionIds } from '@/store/session-states'

import { ISLAND_SURFACE_SELECTOR, useIslandClickThrough } from './island-click-through'
import { type IslandRow, islandRows, islandStage } from './island-model'
import { startIslandSession } from './start-session'
import { useIslandApprovals } from './use-island-approvals'
import { useIslandWindowReport } from './use-island-window-report'

const SURFACE =
  'pointer-events-auto rounded-2xl border border-(--stroke-nous) bg-(--ui-chat-bubble-background) text-(--ui-text-primary) shadow-nous'

const DOT = 'size-1.5 shrink-0 rounded-full'
const ROW = 'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-(--chrome-action-hover)'

function OpenButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button aria-label={label} onClick={onClick} size="icon-xs" title={label} variant="ghost">
      <ArrowUpRight />
    </Button>
  )
}

export function IslandShell() {
  const { t } = useI18n()
  const sessions = useStore($sessions)
  const attentionIds = useStore($attentionSessionIds)
  const workingIds = useStore($workingSessionIds)

  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<null | string>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

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

  const stage = islandStage({
    attentionCount: rows.filter(row => row.state === 'needs-input').length,
    expanded,
    workingCount: rows.filter(row => row.state === 'working').length
  })

  useIslandClickThrough(rootRef)
  useIslandWindowReport(stage, surfaceRef)

  const openSession = useCallback((id: string) => {
    window.hermesDesktop?.island?.openSession?.(id)
    setExpanded(false)
  }, [])

  const approve = useCallback(
    (row: IslandRow) => {
      if (!row.approval) {
        return
      }

      setError(null)
      void answer(row.id, row.approval.requestId, 'once').catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : String(failure))
      )
    },
    [answer]
  )

  const deny = useCallback(
    (row: IslandRow) => {
      if (!row.approval) {
        return
      }

      setError(null)
      void answer(row.id, row.approval.requestId, 'deny').catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : String(failure))
      )
    },
    [answer]
  )

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

      if (expanded) {
        setExpanded(false)
      } else {
        window.hermesDesktop?.island?.setFocusable?.(false)
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, stage])

  const top = rows.find(row => row.state === 'needs-input')
  const attentionCount = rows.filter(row => row.state === 'needs-input').length
  const runningCount = rows.filter(row => row.state === 'working').length

  if (stage === 'hidden') {
    return <div className="h-screen w-screen" ref={rootRef} />
  }

  return (
    <div
      className={cn('flex h-screen w-screen items-start justify-center overflow-hidden', stage !== 'expanded' && 'px-2 pt-1')}
      onBlur={onSurfaceBlur}
      ref={rootRef}
    >
      <div
        className={cn(SURFACE, 'w-full overflow-hidden p-1.5', stage === 'expanded' && 'p-2')}
        data-glass-raised
        data-island-stage={stage}
        data-island-surface=""
        ref={surfaceRef}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              DOT,
              attentionCount > 0 ? 'bg-amber-500' : runningCount > 0 ? 'bg-(--ui-accent)' : 'bg-(--ui-text-tertiary)'
            )}
          />
          <span className="min-w-0 flex-1 truncate text-xs">
            {attentionCount > 0 ? t.island.waiting(attentionCount) : t.island.running(runningCount)}
          </span>
          {top ? <OpenButton label={t.island.open} onClick={() => openSession(top.id)} /> : null}
          <Button
            aria-expanded={expanded}
            aria-label={expanded ? t.island.collapse : t.island.expand}
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
        </div>

        {top ? (
          <div className="mt-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2 py-1.5" data-island-attention="">
            <div className="truncate text-[0.7rem] text-(--ui-text-secondary)">
              {top.title || t.island.needsInput}
            </div>
            {top.approval ? (
              <div className="mt-1 line-clamp-2 font-mono text-[0.7rem] text-(--ui-text-primary)">{top.approval.command}</div>
            ) : (
              <div className="mt-1 text-[0.7rem]">{t.island.needsInput}</div>
            )}
            <div className="mt-1.5 flex items-center gap-1.5">
              {top.approval ? (
                <>
                  <Button onClick={() => deny(top)} size="xs" variant="outline">
                    {t.island.deny}
                  </Button>
                  <Button onClick={() => approve(top)} size="xs" variant="secondary">
                    {t.island.approve}
                  </Button>
                </>
              ) : (
                <Button onClick={() => openSession(top.id)} size="xs" variant="secondary">
                  {t.island.open}
                </Button>
              )}
            </div>
          </div>
        ) : null}

        {error ? <div className="mt-1.5 px-1 text-[0.7rem] text-(--ui-danger, #f87171)">{error}</div> : null}

        {stage === 'expanded' ? (
          <div className="mt-1.5">
            <div className="max-h-64 overflow-y-auto">
              {rows.length === 0 ? (
                <div className="px-2 py-1 text-[0.7rem] text-(--ui-text-tertiary)">{t.island.empty}</div>
              ) : (
                rows.map(row => (
                  <button className={ROW} key={row.id} onClick={() => openSession(row.id)} type="button">
                    <span
                      className={cn(DOT, row.state === 'needs-input' ? 'bg-amber-500' : 'bg-(--ui-accent)')}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs">{row.title || t.island.needsInput}</span>
                    <span className="shrink-0 text-[0.65rem] text-(--ui-text-tertiary)">
                      {row.state === 'needs-input' ? t.island.needsAnswer : t.island.working}
                    </span>
                  </button>
                ))
              )}
            </div>

            <form
              className="mt-1 flex items-center gap-1.5 border-t border-(--stroke-nous) pt-1.5"
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
                className="min-w-0 flex-1 bg-transparent px-1 text-xs outline-none placeholder:text-(--ui-text-tertiary)"
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
      </div>
    </div>
  )
}

export { ISLAND_SURFACE_SELECTOR }
