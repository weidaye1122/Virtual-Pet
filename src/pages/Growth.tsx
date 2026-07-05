import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import { GrowthMap } from '../components/GrowthMap'
import { PointIcon } from '../components/PointIcon'
import { levelRules } from '../data/levelRules'
import { usePetStore } from '../hooks/usePetStore'
import type { PetStatChanges, PointRecord } from '../types'
import { playInteractionFeedback } from '../utils/interactionFeedback'
import { growthStages } from '../utils/level'

const statChangeLabels: Array<{ key: keyof PetStatChanges; label: string }> = [
  { key: 'hunger', label: '饱腹' },
  { key: 'mood', label: '心情' },
  { key: 'clean', label: '清洁' },
  { key: 'energy', label: '体力' },
]

const formatChange = (value: number) => (value > 0 ? `+${value}` : String(value))

const getChangeTone = (value: number) =>
  value >= 0 ? 'history-item__meta-pill--gain' : 'history-item__meta-pill--loss'

const RecordBadges = ({ record }: { record: PointRecord }) => {
  const statBadges = statChangeLabels
    .map(({ key, label }) => ({
      key,
      label,
      value: record.statChanges?.[key] ?? 0,
    }))
    .filter((item) => item.value !== 0)

  if (record.change === 0 && !record.growthChange && statBadges.length === 0) {
    return (
      <span className="history-item__meta-pill history-item__meta-pill--neutral">
        {record.detail ?? '已记录'}
      </span>
    )
  }

  return (
    <>
      {record.change !== 0 ? (
        <span className={`history-item__meta-pill ${getChangeTone(record.change)}`}>
          <PointIcon size="sm" /> {formatChange(record.change)}
        </span>
      ) : null}
      {record.growthChange ? (
        <span className={`history-item__meta-pill ${getChangeTone(record.growthChange)}`}>
          ⭐ {formatChange(record.growthChange)}
        </span>
      ) : null}
      {statBadges.map((badge) => (
        <span className={`history-item__meta-pill ${getChangeTone(badge.value)}`} key={badge.key}>
          {badge.label} {formatChange(badge.value)}
        </span>
      ))}
    </>
  )
}

export const Growth = () => {
  const {
    pet,
    meta,
    taskStats,
    growthProgress,
    nextLevelRule,
    pointRecords,
    undoPointRecord,
  } = usePetStore()
  const [managedRecordId, setManagedRecordId] = useState('')
  const longPressTimerRef = useRef<number | null>(null)
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null)
  const didLongPressRef = useRef(false)
  const managedRecord = pointRecords.find((record) => record.id === managedRecordId)

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const openRecordMenu = (recordId: string) => {
    didLongPressRef.current = true
    playInteractionFeedback('longPress')
    setManagedRecordId(recordId)
  }

  useEffect(
    () => () => {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current)
      }
    },
    [],
  )

  const handleRecordPointerDown = (
    record: PointRecord,
    event: PointerEvent<HTMLElement>,
  ) => {
    if (!record.undo || (event.pointerType === 'mouse' && event.button !== 0)) {
      return
    }

    const target = event.target as HTMLElement

    if (target.closest('button, a')) {
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
      openRecordMenu(record.id)
    }, 1_200)
  }

  const handleRecordPointerMove = (event: PointerEvent<HTMLElement>) => {
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

  const handleRecordPointerEnd = (event: PointerEvent<HTMLElement>) => {
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

  const handleRecordPointerLeave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse') {
      handleRecordPointerEnd(event)
    }
  }

  const handleRecordClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!didLongPressRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    didLongPressRef.current = false
  }

  return (
    <div className="page-stack page-stack--growth">
      <section className="panel growth-panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">成长地图</p>
            <h2>{pet.name} 正在一步一步变得更闪亮</h2>
          </div>
        </div>

        <div className="growth-summary growth-summary--map">
          <article className="metric-card metric-card--stage">
            <span>当前阶段</span>
            <strong>{pet.stage}</strong>
            <small>Lv.{pet.level}</small>
          </article>
          <article className="metric-card metric-card--growth">
            <span>成长值</span>
            <strong>{pet.growthValue}</strong>
            <small>
              {nextLevelRule ? `下一站 Lv.${nextLevelRule.level}` : '已到当前最高等级'}
            </small>
          </article>
          <article className="metric-card metric-card--progress">
            <span>升级进度</span>
            <strong>{growthProgress.percentage}%</strong>
            <small>
              {nextLevelRule ? `还差 ${growthProgress.remaining} 点成长值` : '已经满满当当'}
            </small>
          </article>
          <article className="metric-card metric-card--companion">
            <span>连续陪伴</span>
            <strong>{meta.streakCount} 天</strong>
            <small>今天已领取 {taskStats.claimed} 个任务奖励</small>
          </article>
        </div>

        <GrowthMap currentGrowth={pet.growthValue} currentLevel={pet.level} rules={levelRules} stages={growthStages} />
      </section>

      <section className="panel growth-panel growth-panel--records">
        <div className="panel__header">
          <div>
            <p className="eyebrow">积分记录</p>
            <h2>最近的小小成就</h2>
          </div>
        </div>
        {pointRecords.length === 0 ? (
          <div className="empty-card">
            <strong>还没有积分记录</strong>
            <p>先去完成一个任务，很快就会看到成长的足迹啦。</p>
          </div>
        ) : (
          <div className="history-list history-list--grid">
            {pointRecords.map((record) => (
              <article
                className={`history-item ${record.undo ? 'history-item--manageable' : ''}`}
                key={record.id}
                onClickCapture={handleRecordClickCapture}
                onContextMenu={(event) => {
                  if (record.undo) {
                    event.preventDefault()
                    clearLongPressTimer()
                    openRecordMenu(record.id)
                  }
                }}
                onPointerCancel={handleRecordPointerEnd}
                onPointerDown={(event) => handleRecordPointerDown(record, event)}
                onPointerLeave={handleRecordPointerLeave}
                onPointerMove={handleRecordPointerMove}
                onPointerUp={handleRecordPointerEnd}
              >
                <div>
                  <strong>{record.title}</strong>
                  <small>{new Date(record.createdAt).toLocaleString('zh-CN')}</small>
                </div>
                <div className="history-item__meta">
                  <RecordBadges record={record} />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {managedRecord ? (
        <div
          className="task-manage-modal"
          onClick={() => setManagedRecordId('')}
          role="presentation"
        >
          <section
            aria-label={`撤销记录 ${managedRecord.title}`}
            aria-modal="true"
            className="task-manage-sheet history-undo-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="task-manage-sheet__summary">
              <span className="emoji-badge" aria-hidden="true">
                ↩
              </span>
              <div>
                <small>撤销记录</small>
                <strong>{managedRecord.title}</strong>
              </div>
            </div>

            <div className="task-manage-sheet__actions history-undo-sheet__actions">
              <button
                className="ghost-button ghost-button--danger"
                onClick={() => {
                  undoPointRecord(managedRecord.id)
                  setManagedRecordId('')
                }}
                type="button"
              >
                撤销这次操作
              </button>
            </div>

            <button
              className="ghost-button task-manage-sheet__cancel"
              onClick={() => setManagedRecordId('')}
              type="button"
            >
              取消
            </button>
          </section>
        </div>
      ) : null}
    </div>
  )
}
