import { formatDate, todayIso } from '@/shared/lib/dates'
import { PRIORITY_LABELS, type Task } from '../types'
import '../tasks.css'

interface TaskCardProps {
  task: Task
  /** When given, the title becomes a button that opens the task for editing. */
  onEdit?: (task: Task) => void
}

export function TaskCard({ task, onEdit }: TaskCardProps) {
  const overdue = task.status !== 'done' && task.dueDate !== null && task.dueDate < todayIso()

  return (
    <div className="task-card__body">
      <div className="task-card__top">
        {onEdit ? (
          <button
            type="button"
            className="task-card__title task-card__edit"
            aria-label={`Edit task: ${task.title}`}
            onClick={() => onEdit(task)}
          >
            {task.title}
          </button>
        ) : (
          <span className="task-card__title">{task.title}</span>
        )}
        <span className={`chip chip--priority-${task.priority}`}>
          <span className="visually-hidden">Priority:</span> {PRIORITY_LABELS[task.priority]}
        </span>
      </div>
      {task.dueDate && (
        <div className={`task-card__due${overdue ? ' is-overdue' : ''}`}>
          <span>Due {formatDate(task.dueDate)}</span>
          {overdue && <span className="chip chip--danger">Overdue</span>}
        </div>
      )}
      {task.tags.length > 0 && (
        <ul className="task-card__tags" aria-label="Tags">
          {task.tags.map((tag) => (
            <li key={tag} className="chip">
              {tag}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
