import { Draggable, Droppable } from '@hello-pangea/dnd'
import { Button } from '@/shared/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { useColumnTasks } from '../api/hooks'
import { flattenColumn } from '../boardCache'
import { STATUS_LABELS, type BoardFilters, type Task, type TaskStatus } from '../types'
import { TaskCard } from './TaskCard'
import '../tasks.css'

interface BoardColumnProps {
  status: TaskStatus
  filters: BoardFilters
  onOpen: (task: Task) => void
  onAdd: (status: TaskStatus) => void
}

export function BoardColumn({ status, filters, onOpen, onAdd }: BoardColumnProps) {
  const query = useColumnTasks(status, filters)
  const label = STATUS_LABELS[status]
  const tasks = flattenColumn(query.data)
  const total = query.data?.pages[0]?.total ?? 0

  return (
    <section className="column" aria-label={label}>
      <header className="column__header">
        <h2>{label}</h2>
        <span className="column__count muted">{total}</span>
        <Button variant="ghost" onClick={() => onAdd(status)} aria-label={`Add task to ${label}`}>
          +
        </Button>
      </header>

      {query.isPending && <LoadingState label="Loading…" />}
      {query.isError && (
        <ErrorState message="Could not load this column" onRetry={() => void query.refetch()} />
      )}

      {query.data && (
        <Droppable droppableId={status}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`column__list${snapshot.isDraggingOver ? ' is-over' : ''}`}
            >
              {tasks.length === 0 && !snapshot.isDraggingOver && (
                <EmptyState title="Nothing here yet" description="Drag a card here or add one." />
              )}
              {tasks.map((task, index) => (
                <Draggable key={task.id} draggableId={task.id} index={index}>
                  {(drag, dragSnapshot) => (
                    <div
                      ref={drag.innerRef}
                      {...drag.draggableProps}
                      {...drag.dragHandleProps}
                      className={`task-card${dragSnapshot.isDragging ? ' is-dragging' : ''}`}
                    >
                      <TaskCard task={task} onEdit={onOpen} />
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      )}

      {query.hasNextPage && (
        <Button onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </section>
  )
}
