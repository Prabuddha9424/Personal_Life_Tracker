import { useState } from 'react'
import { BoardToolbar } from '../components/BoardToolbar'
import { TaskBoard } from '../components/TaskBoard'
import { TaskFormModal, type TaskFormMode } from '../components/TaskFormModal'
import type { BoardFilters } from '../types'

export default function BoardPage() {
  const [filters, setFilters] = useState<BoardFilters>({})
  const [modal, setModal] = useState<TaskFormMode | null>(null)

  return (
    <div>
      <h1>Board</h1>
      <BoardToolbar
        filters={filters}
        onChange={setFilters}
        onNew={() => setModal({ kind: 'create', status: 'todo' })}
      />
      <TaskBoard
        filters={filters}
        onOpen={(task) => setModal({ kind: 'edit', task })}
        onAdd={(status) => setModal({ kind: 'create', status })}
      />
      {modal && <TaskFormModal mode={modal} onClose={() => setModal(null)} />}
    </div>
  )
}
