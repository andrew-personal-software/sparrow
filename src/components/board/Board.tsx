'use client'

import { useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, closestCorners, pointerWithin, useSensor, useSensors } from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { isDone } from '@/core/columns'
import { useKb } from '@/client/store'
import { Column } from './Column'
import { Card } from './Card'

// Anywhere inside a column counts as dropping into it: only that column and
// its cards compete. Between columns, fall back to the nearest target overall.
const collisionDetection: CollisionDetection = (args) => {
  const col = pointerWithin(args).find((c) => String(c.id).startsWith('col:'))
  if (!col) return closestCorners(args)
  const listId = `list:${String(col.id).slice(4)}`
  const droppableContainers = args.droppableContainers.filter(
    (c) => c.id === col.id || c.data.current?.sortable?.containerId === listId,
  )
  return closestCorners({ ...args, droppableContainers })
}

export function Board() {
  // Only config/columns is subscribed here — it's a stable reference across
  // task ops (only a fresh snapshot replaces it), so Board itself never
  // re-renders from a task update. Each Column tracks its own visible task
  // ids; handleDragEnd reads fresh data via getState() instead of
  // subscribing, since it only needs it at drop time.
  const columns = useKb((s) => s.index?.config.columns)
  const op = useKb((s) => s.op)
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragStart(event: DragStartEvent): void {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    const id = String(active.id)
    const overId = String(over.id)
    if (overId === id) return

    const state = useKb.getState()
    const index = state.index
    if (!index) return
    const task = state.byId[id]
    if (!task) return
    const destKey = overId.startsWith('col:') ? overId.slice(4) : state.byId[overId]?.status
    if (!destKey) return

    // Columns are sorted by project and number, so only a column change matters.
    if (task.status === destKey) return
    const completed = isDone(index.config, destKey) ? (task.completed ?? new Date().toISOString()) : undefined
    void op(id, { type: 'setStatus', status: destKey }, (t) => ({ ...t, status: destKey, completed }))
  }

  if (!columns) {
    return <div className="p-8 text-sm text-gray-500">Loading…</div>
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex min-h-full justify-center-safe gap-4 overflow-x-auto p-4">
        {columns.map((col) => (
          <Column key={col.key} column={col} />
        ))}
      </div>
      <DragOverlay>{activeId ? <Card taskId={activeId} dragOverlay /> : null}</DragOverlay>
    </DndContext>
  )
}
