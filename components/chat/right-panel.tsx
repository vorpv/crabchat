"use client"

import { useRef, useState } from "react"
import type React from "react"
import { ChevronDown, ChevronRight, X } from "lucide-react"
import { cn } from "@/lib/utils"

export interface CrabChatPanelBlock {
  id: string
  title: string
  icon?: React.ReactNode
  actions?: React.ReactNode
  content: React.ReactNode
}

interface CrabChatPanelProps {
  blocks: CrabChatPanelBlock[]
  onCloseBlock: (id: string) => void
}

export function CrabChatPanel({ blocks, onCloseBlock }: CrabChatPanelProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [closingIds, setClosingIds] = useState<Set<string>>(new Set())
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [panelWidth, setPanelWidth] = useState(448)
  const [resizingPanel, setResizingPanel] = useState(false)
  const [resizingBlocks, setResizingBlocks] = useState(false)
  const blockRefs = useRef(new Map<string, HTMLElement>())
  const visibleBlocks = blocks
  const expandedBlocks = visibleBlocks.filter(
    (block) => !collapsedIds.has(block.id) && !closingIds.has(block.id)
  )
  const hasBlocks = visibleBlocks.length > 0
  const activePanelWidth = hasBlocks ? panelWidth : 0
  const cappedPanelWidth = `min(${activePanelWidth}px, 55vw)`
  const transitionClass =
    resizingPanel || resizingBlocks
      ? "transition-none"
      : "transition-[width,opacity,transform,flex-basis,flex-grow] duration-200 ease-out motion-reduce:transition-none"

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const closeBlock = (id: string) => {
    setClosingIds((current) => new Set(current).add(id))
    window.setTimeout(() => {
      setClosingIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
      onCloseBlock(id)
    }, 180)
  }

  const setBlockRef = (id: string, element: HTMLElement | null) => {
    if (element) blockRefs.current.set(id, element)
    else blockRefs.current.delete(id)
  }

  const startResize = (beforeId: string, afterId: string, event: React.PointerEvent) => {
    event.preventDefault()
    setResizingBlocks(true)
    const startY = event.clientY
    const beforeWeight = weights[beforeId] || 1
    const afterWeight = weights[afterId] || 1
    const total = beforeWeight + afterWeight
    const beforeHeight = blockRefs.current.get(beforeId)?.getBoundingClientRect().height || 0
    const afterHeight = blockRefs.current.get(afterId)?.getBoundingClientRect().height || 0
    const pairHeight = Math.max(1, beforeHeight + afterHeight)

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = ((moveEvent.clientY - startY) / pairHeight) * total
      const nextBefore = Math.max(0.3, Math.min(total - 0.3, beforeWeight + delta))
      setWeights((current) => ({
        ...current,
        [beforeId]: nextBefore,
        [afterId]: Math.max(0.3, total - nextBefore),
      }))
    }

    const handleUp = () => {
      setResizingBlocks(false)
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
  }

  const startPanelResize = (event: React.PointerEvent) => {
    event.preventDefault()
    setResizingPanel(true)
    const startX = event.clientX
    const startWidth = panelWidth

    const handleMove = (moveEvent: PointerEvent) => {
      const viewportMax = Math.max(360, window.innerWidth * 0.65)
      const nextWidth = Math.max(320, Math.min(viewportMax, startWidth - (moveEvent.clientX - startX)))
      setPanelWidth(nextWidth)
    }

    const handleUp = () => {
      setResizingPanel(false)
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
  }

  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 overflow-hidden border-l border-border bg-background",
        transitionClass,
        !hasBlocks
          ? "w-0 translate-x-2 border-l-0 opacity-0"
          : "translate-x-0 opacity-100"
      )}
      style={{ width: cappedPanelWidth }}
      aria-hidden={!hasBlocks}
    >
      {hasBlocks && (
        <button
          type="button"
          aria-label="Resize panel"
          className="h-full w-1.5 shrink-0 cursor-col-resize bg-border/50 transition-colors hover:bg-ring"
          onPointerDown={startPanelResize}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {visibleBlocks.map((block, index) => {
          const collapsed = collapsedIds.has(block.id)
          const closing = closingIds.has(block.id)
          const nextExpanded = visibleBlocks.slice(index + 1).find((item) => !collapsedIds.has(item.id))

          return (
            <PanelBlockFrame
              key={block.id}
              block={block}
              collapsed={collapsed}
              closing={closing}
              weight={weights[block.id] || 1}
              transitionClass={transitionClass}
              setBlockRef={(element) => setBlockRef(block.id, element)}
              onToggleCollapsed={() => toggleCollapsed(block.id)}
              onClose={() => closeBlock(block.id)}
              splitter={
                index < visibleBlocks.length - 1 && !closing ? (
                  <button
                    type="button"
                    aria-label="Resize panel blocks"
                    className="h-1.5 shrink-0 cursor-row-resize bg-border/60 transition-colors hover:bg-ring"
                    onPointerDown={(event) => {
                      if (collapsed || !nextExpanded || expandedBlocks.length < 2) return
                      startResize(block.id, nextExpanded.id, event)
                    }}
                  />
                ) : null
              }
            />
          )
        })}
      </div>
    </aside>
  )
}

function PanelBlockFrame({
  block,
  collapsed,
  closing,
  weight,
  transitionClass,
  setBlockRef,
  onToggleCollapsed,
  onClose,
  splitter,
}: {
  block: CrabChatPanelBlock
  collapsed: boolean
  closing: boolean
  weight: number
  transitionClass: string
  setBlockRef: (element: HTMLElement | null) => void
  onToggleCollapsed: () => void
  onClose: () => void
  splitter: React.ReactNode
}) {
  return (
    <>
      <section
        ref={setBlockRef}
        className={cn("min-h-0 overflow-hidden bg-background", transitionClass, closing && "opacity-0")}
        style={{
          flexGrow: collapsed || closing ? 0 : weight,
          flexShrink: 1,
          flexBasis: collapsed ? "40px" : closing ? "0px" : "0px",
        }}
      >
        <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-2">
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? "Expand block" : "Collapse block"}
              title={collapsed ? "Expand" : "Collapse"}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {block.icon}
            <h2 className="truncate text-sm font-medium text-foreground">{block.title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!collapsed && block.actions}
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${block.title}`}
              title="Close"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div
          className={cn(
            "grid h-[calc(100%-2.5rem)] transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
            collapsed || closing ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
          )}
        >
          <div className="min-h-0 overflow-hidden">{block.content}</div>
        </div>
      </section>
      {splitter}
    </>
  )
}
