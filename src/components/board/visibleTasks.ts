import { isDone } from '@/core/columns'
import type { CreateInput, Index, TaskView } from '@/core'
import { applyFilters } from '@/client/store'
import type { Filters } from '@/client/store'
import type { OutboxEntry } from '@/client/outbox'

// Monday 00:00 local time.
function startOfWeek(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

function completedThisWeek(completed?: string): boolean {
  if (!completed) return false
  return new Date(completed).getTime() >= startOfWeek()
}

function taskNum(id: string): number {
  return Number(id.slice(id.lastIndexOf('-') + 1))
}

/** Board order: project A→Z, then task number ascending. */
export function byProjectThenNum(a: TaskView, b: TaskView): number {
  return a.project.localeCompare(b.project) || taskNum(a.id) - taskNum(b.id)
}

/** Tasks for one board column: filtered, done-this-week rule applied, sorted by project then number. */
export function visibleColumnTasks(index: Index, filters: Filters, columnKey: string): TaskView[] {
  const visible = applyFilters(index.tasks, { ...filters, showDone: true }, index.config)
  let tasks = visible.filter((t) => t.status === columnKey)
  if (isDone(index.config, columnKey) && !filters.showDone) {
    tasks = tasks.filter((t) => completedThisWeek(t.completed))
  }
  return tasks.sort(byProjectThenNum)
}

/** The project a queued create will land in: its own, else its parent's. */
export function pendingProject(input: CreateInput): string | undefined {
  if (input.project) return input.project.toUpperCase()
  const dash = input.parent?.lastIndexOf('-') ?? -1
  return dash > 0 ? input.parent!.slice(0, dash).toUpperCase() : undefined
}

/** Outbox entries shown as pending cards in a column: not yet created, or failed, and in a shown project. */
export function pendingForColumn(pending: OutboxEntry[], readyKey: string | undefined, columnKey: string, hidden: string[]): OutboxEntry[] {
  return pending.filter(
    (e) =>
      (!e.taskId || e.error) &&
      (e.input.status ?? readyKey) === columnKey &&
      !hidden.includes(pendingProject(e.input) ?? ''),
  )
}
