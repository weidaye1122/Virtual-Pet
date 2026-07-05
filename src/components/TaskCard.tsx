import { useEffect, useRef } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import { PointIcon } from './PointIcon'
import type { Task } from '../types'
import { playInteractionFeedback } from '../utils/interactionFeedback'

type TaskCardProps = {
  task: Task
  onComplete: () => void
  onClaim: () => void
  onManage?: () => void
}

export const TaskCard = ({
  task,
  onComplete,
  onClaim,
  onManage,
}: TaskCardProps) => {
  const longPressTimerRef = useRef<number | null>(null)
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null)
  const didLongPressRef = useRef(false)
  const canManage = Boolean(onManage)
  const currentStatus =
    task.status === 'todo'
      ? {
          chipClass: 'status-pill--todo',
          chipLabel: '待完成',
          hidden: false,
        }
      : {
          chipClass: 'status-pill--ghost',
          chipLabel: '待完成',
          hidden: true,
        }
  const actionConfig =
    task.status === 'todo'
      ? {
          className: 'primary-button',
          disabled: false,
          label: '我完成啦',
          onClick: onComplete,
        }
      : task.status === 'done'
        ? {
            className: 'primary-button',
            disabled: false,
            label: '领取奖励',
            onClick: onClaim,
          }
        : {
            className: 'primary-button',
            disabled: true,
            label: '已完成',
            onClick: onClaim,
          }

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const openManageMenu = () => {
    if (!onManage) {
      return
    }

    didLongPressRef.current = true
    playInteractionFeedback('longPress')
    onManage()
  }

  useEffect(
    () => () => {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current)
      }
    },
    [],
  )

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!onManage || (event.pointerType === 'mouse' && event.button !== 0)) {
      return
    }

    const target = event.target as HTMLElement

    if (target.closest('button, input, textarea, select, a')) {
      return
    }

    clearLongPressTimer()
    didLongPressRef.current = false
    longPressStartRef.current = { x: event.clientX, y: event.clientY }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Some touch browsers do not allow capture for long-press gestures.
    }
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      openManageMenu()
    }, 2_000)
  }

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!longPressStartRef.current) {
      return
    }

    const deltaX = Math.abs(event.clientX - longPressStartRef.current.x)
    const deltaY = Math.abs(event.clientY - longPressStartRef.current.y)

    if (deltaX > 10 || deltaY > 10) {
      clearLongPressTimer()
      longPressStartRef.current = null
    }
  }

  const handlePointerEnd = (event: PointerEvent<HTMLElement>) => {
    clearLongPressTimer()
    longPressStartRef.current = null

    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Ignore browsers that drop capture after cancelling a touch gesture.
    }
  }

  const handlePointerLeave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse') {
      handlePointerEnd(event)
    }
  }

  const handleClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!didLongPressRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    didLongPressRef.current = false
  }

  return (
    <article
      className={`task-card ${canManage ? 'task-card--manageable' : ''}`}
      onClickCapture={handleClickCapture}
      onContextMenu={(event) => {
        if (canManage) {
          event.preventDefault()
          clearLongPressTimer()
          openManageMenu()
        }
      }}
      onPointerCancel={handlePointerEnd}
      onPointerDown={handlePointerDown}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
    >
      <div className="task-card__header">
        <div className="task-card__title">
          <span className="emoji-badge" aria-hidden="true">
            {task.icon}
          </span>
          <div>
            <strong>{task.title}</strong>
          </div>
        </div>
      </div>

      <div className="reward-row">
        <span className="point-inline">
          <PointIcon size="sm" /> +{task.points}
        </span>
        <span>⭐ +{task.growth}</span>
        <span
          aria-hidden={currentStatus.hidden}
          className={`status-pill ${currentStatus.chipClass}`}
        >
          {currentStatus.chipLabel}
        </span>
      </div>

      <div className="task-card__actions task-card__actions--single">
        <button
          className={actionConfig.className}
          disabled={actionConfig.disabled}
          onClick={actionConfig.onClick}
          type="button"
        >
          {actionConfig.label}
        </button>
      </div>
    </article>
  )
}
