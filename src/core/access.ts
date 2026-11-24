import { KbError } from './errors'
import { viewTask } from './indexer'
import type { Index } from './indexer'
import { INBOX, normalizeProjectKey } from './keys'
import type { CreateInput, Op } from './ops'
import type { Identity, Task } from './types'

type User = Identity & { kind: 'user' }

const deny = (message: string): never => {
  throw new KbError('forbidden', message)
}

function inProject(index: Index, username: string, key: string): boolean {
  const p = index.projects.find((x) => x.key === key)
  return !!p && (p.owner === username || p.members.includes(username))
}

export function canWriteProject(index: Index, id: Identity, key: string): boolean {
  return id.kind === 'user' && (id.admin || inProject(index, id.username, key))
}

/** Members and owners see a project's tasks. A reporter also sees their own feedback while it is in CROW. */
export function canSee(index: Index, id: Identity, task: Task): boolean {
  if (id.kind === 'service') return id.name === 'hawk' || task.project === 'CROW'
  if (id.admin || inProject(index, id.username, task.project)) return true
  return task.project === 'CROW' && task.extra.reporter === id.username
}

export function canWrite(index: Index, id: Identity, task: Task): boolean {
  return canWriteProject(index, id, task.project)
}

export function canManageProject(index: Index, id: Identity, key: string): boolean {
  return id.kind === 'user' && (id.admin || index.projects.find((p) => p.key === key)?.owner === id.username)
}

const visible = (index: Index, id: Identity, key: string) => {
  const t = viewTask(index, key.toUpperCase())
  return !!t && canSee(index, id, t)
}

/** Throws forbidden unless `id` may apply `op` to `task`. The caller has already checked canSee. */
export function checkOp(index: Index, id: Identity, task: Task, op: Op): void {
  if (id.kind === 'service') {
    if (id.name === 'hawk' && (op.type === 'addComment' || op.type === 'setStatus')) return
    return deny(`${id.name} cannot ${op.type}`)
  }
  if (!canSee(index, id, task)) return deny(`no access to ${task.id}`)
  switch (op.type) {
    case 'setTitle':
    case 'setBody':
    case 'addComment':
      return
    case 'editComment':
      if (id.admin || task.comments[op.index]?.author === id.username) return
      return deny('only the author can edit a comment')
    case 'setProject':
      if (canWrite(index, id, task) && canWriteProject(index, id, normalizeProjectKey(op.project))) return
      return deny(`no access to project ${op.project}`)
    case 'addLink':
      if (canWrite(index, id, task) && visible(index, id, op.link.id)) return
      return deny(`no access to ${op.link.id}`)
    case 'setParent':
      if (canWrite(index, id, task) && (op.parent === null || visible(index, id, op.parent))) return
      return deny(`no access to ${op.parent}`)
    default:
      if (canWrite(index, id, task)) return
      return deny(`no write access to ${task.id}`)
  }
}

/** Throws forbidden unless `id` may create this task. Only crow may set a reporter, and only in CROW. */
export function checkCreate(index: Index, id: Identity, input: CreateInput & { reporter?: string }): void {
  if (id.kind === 'service') {
    if (id.name === 'crow' && input.project && normalizeProjectKey(input.project) === 'CROW' && !input.parent) return
    return deny(`${id.name} can only create CROW feedback`)
  }
  if (input.reporter !== undefined) return deny('only crow can set a reporter')
  const parent = input.parent ? viewTask(index, input.parent.toUpperCase()) : undefined
  if (input.parent && (!parent || !canSee(index, id, parent))) return deny(`no access to ${input.parent}`)
  const project = parent?.project ?? (input.project ? normalizeProjectKey(input.project) : INBOX)
  if (!canWriteProject(index, id, project)) return deny(`no access to project ${project}`)
  for (const link of input.links ?? []) if (!visible(index, id, link.id)) deny(`no access to ${link.id}`)
}

/** The index as `id` may see it: hidden tasks are gone, and so is every pointer to them. */
export function visibleIndex(index: Index, id: User): Index {
  const me = { username: id.username, admin: id.admin }
  if (id.admin) return { ...index, me }
  const tasks = index.tasks.filter((t) => canSee(index, id, t))
  const ids = new Set(tasks.map((t) => t.id))
  const keys = new Set(tasks.map((t) => t.project))
  return {
    ...index,
    me,
    projects: index.projects.filter((p) => inProject(index, id.username, p.key) || keys.has(p.key)),
    tasks: tasks.map((t) => ({
      ...t,
      parent: t.parent && ids.has(t.parent) ? t.parent : undefined,
      links: t.links.filter((l) => ids.has(l.id)),
      backlinks: t.backlinks.filter((b) => ids.has(b.id)),
      children: t.children.filter((c) => ids.has(c)),
    })),
    moved: Object.fromEntries(Object.entries(index.moved).filter(([, to]) => ids.has(to))),
  }
}
