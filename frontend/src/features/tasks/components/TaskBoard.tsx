import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { useQueryClient } from '@tanstack/react-query'
import { useMoveTask } from '../api/hooks'
import { taskKeys } from '../api/taskKeys'
import { flattenColumn, neighboursFor, type ColumnData } from '../boardCache'
import {
  isTaskStatus,
  TASK_STATUSES,
  type BoardFilters,
  type Task,
  type TaskStatus,
} from '../types'
import { BoardColumn } from './BoardColumn'
import '../tasks.css'

interface TaskBoardProps {
  filters: BoardFilters
  onOpen: (task: Task) => void
  onAdd: (status: TaskStatus) => void
}

export function TaskBoard({ filters, onOpen, onAdd }: TaskBoardProps) {
  const client = useQueryClient()
  const { mutate: moveTask } = useMoveTask()

  const columnItems = (status: TaskStatus) =>
    flattenColumn(client.getQueryData<ColumnData>(taskKeys.column(status, filters)))

  function handleDragEnd({ source, destination, draggableId }: DropResult) {
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return
    if (!isTaskStatus(source.droppableId) || !isTaskStatus(destination.droppableId)) return

    const task = columnItems(source.droppableId).find((item) => item.id === draggableId)
    if (!task) return

    const { afterId, beforeId } = neighboursFor(
      columnItems(destination.droppableId),
      task.id,
      destination.index,
    )
    // Both neighbours are sent whenever they exist, because the server does not check that a
    // one-sided drop is really at the edge. If the destination has more pages than are loaded, a
    // drop at the loaded end has no beforeId, so the server places the card after ALL cards while
    // the optimistic cache shows it after the loaded ones. The refetch that useMoveTask always
    // runs when the move settles corrects that; the loaded end is not a true edge until then.
    moveTask({
      task,
      toStatus: destination.droppableId,
      toIndex: destination.index,
      filters,
      afterId,
      beforeId,
    })
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="board">
        {TASK_STATUSES.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            filters={filters}
            onOpen={onOpen}
            onAdd={onAdd}
          />
        ))}
      </div>
    </DragDropContext>
  )
}
