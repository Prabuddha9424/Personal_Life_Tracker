import { useState, type FormEvent } from 'react'
import { Button } from '@/shared/ui/Button'
import { useTags } from '../api/hooks'
import type { BoardFilters } from '../types'
import '../tasks.css'

interface BoardToolbarProps {
  filters: BoardFilters
  onChange: (filters: BoardFilters) => void
  onNew: () => void
}

/** The server rejects a search longer than this with a 400. */
const MAX_SEARCH_LENGTH = 100

/**
 * The server rejects blank q/tag and an over-long q, so a blank value is left out of the filters
 * entirely and the search is cut to the length the server accepts.
 */
function buildFilters(tag: string | undefined, q: string | undefined): BoardFilters {
  const cleanTag = tag?.trim()
  const cleanQ = q?.trim().slice(0, MAX_SEARCH_LENGTH).trim()
  return { ...(cleanTag ? { tag: cleanTag } : {}), ...(cleanQ ? { q: cleanQ } : {}) }
}

export function BoardToolbar({ filters, onChange, onNew }: BoardToolbarProps) {
  const { data: tags = [] } = useTags()
  const [search, setSearch] = useState(filters.q ?? '')

  function applySearch(event: FormEvent) {
    event.preventDefault()
    const next = buildFilters(filters.tag, search)
    setSearch(next.q ?? '')
    onChange(next)
  }

  function applyTag(tag: string) {
    onChange(buildFilters(tag, filters.q))
  }

  return (
    <div className="board-toolbar">
      <form role="search" aria-label="Board search" onSubmit={applySearch}>
        <input
          type="search"
          aria-label="Search tasks"
          maxLength={MAX_SEARCH_LENGTH}
          placeholder="Search tasks"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button type="submit">Search</Button>
      </form>
      <select
        aria-label="Filter by tag"
        value={filters.tag ?? ''}
        onChange={(event) => applyTag(event.target.value)}
      >
        <option value="">All tags</option>
        {tags.map((tag) => (
          <option key={tag} value={tag}>
            {tag}
          </option>
        ))}
      </select>
      <Button variant="primary" onClick={onNew}>
        New task
      </Button>
    </div>
  )
}
