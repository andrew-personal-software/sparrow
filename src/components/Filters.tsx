'use client'

import { useKb } from '@/client/store'
import type { Project } from '@/core'
import { ProjectSquare } from '@/components/ProjectSquare'

const NO_PROJECTS: Project[] = []

export function Filters() {
  const filters = useKb((s) => s.filters)
  const setFilters = useKb((s) => s.setFilters)
  const projects = useKb((s) => s.index?.projects ?? NO_PROJECTS)
  const { hidden } = filters

  function toggle(key: string): void {
    setFilters({ hidden: hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key] })
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={filters.showDone}
          onChange={(e) => setFilters({ showDone: e.target.checked })}
        />
        Show done
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        {projects.map((p) => {
          const on = !hidden.includes(p.key)
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => toggle(p.key)}
              aria-pressed={on}
              title={p.name}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs ${
                on ? 'border-gray-400 text-gray-900' : 'border-gray-200 text-gray-400 opacity-60'
              }`}
            >
              <ProjectSquare color={p.color} />
              {p.key}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setFilters({ hidden: hidden.length ? [] : projects.map((p) => p.key) })}
          className="px-1 text-xs text-gray-500 hover:text-gray-900"
        >
          {hidden.length ? 'Show all' : 'Hide all'}
        </button>
      </div>
    </div>
  )
}
