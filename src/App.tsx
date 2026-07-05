import { useEffect, useRef, useState } from 'react'
import type {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  SyntheticEvent,
} from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppUpdatePrompt } from './components/AppUpdatePrompt'
import { AuthGate } from './components/AuthGate'
import { BottomNav } from './components/BottomNav'
import { LevelUpCelebration } from './components/LevelUpCelebration'
import { PetProvider } from './hooks/PetProvider'
import { ToastProvider } from './hooks/ToastProvider'
import { usePetStore } from './hooks/usePetStore'
import { Growth } from './pages/Growth'
import { Home } from './pages/Home'
import { Inventory } from './pages/Inventory'
import { Shop } from './pages/Shop'
import { Tasks } from './pages/Tasks'
import {
  isInteractionFeedbackKind,
  playInteractionFeedback,
} from './utils/interactionFeedback'

const AVATAR_OUTPUT_SIZE = 512
const AVATAR_INITIAL_CROP_RATIO = 0.82
const AVATAR_MIN_CROP_RATIO = 0.35

type AvatarImageSize = {
  height: number
  width: number
}

type AvatarCropSelection = {
  size: number
  x: number
  y: number
}

type AvatarCropDrag = {
  pointerId: number
  scale: number
  startClientX: number
  startClientY: number
  startCrop: AvatarCropSelection
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const createAvatarCropSelection = ({ height, width }: AvatarImageSize): AvatarCropSelection => {
  const maxSize = Math.min(width, height)
  const size = Math.max(1, Math.round(maxSize * AVATAR_INITIAL_CROP_RATIO))

  return {
    size,
    x: Math.round((width - size) / 2),
    y: Math.round((height - size) / 2),
  }
}

const getAvatarCropLimits = ({ height, width }: AvatarImageSize) => {
  const max = Math.min(width, height)

  return {
    max,
    min: Math.max(1, Math.round(max * AVATAR_MIN_CROP_RATIO)),
  }
}

const getAvatarRenderedScale = (stage: HTMLDivElement, imageSize: AvatarImageSize) => {
  const rect = stage.getBoundingClientRect()
  const scale = Math.min(rect.width / imageSize.width, rect.height / imageSize.height)

  return Number.isFinite(scale) && scale > 0 ? scale : null
}

const getAvatarCropStyle = (crop: AvatarCropSelection, imageSize: AvatarImageSize) => {
  const imageRatio = imageSize.width / imageSize.height

  if (imageRatio >= 1) {
    const renderedHeight = 100 / imageRatio
    const topOffset = (100 - renderedHeight) / 2
    const size = (crop.size / imageSize.width) * 100

    return {
      height: `${size}%`,
      left: `${(crop.x / imageSize.width) * 100}%`,
      top: `${topOffset + (crop.y / imageSize.height) * renderedHeight}%`,
      width: `${size}%`,
    }
  }

  const renderedWidth = imageRatio * 100
  const leftOffset = (100 - renderedWidth) / 2
  const size = (crop.size / imageSize.height) * 100

  return {
    height: `${size}%`,
    left: `${leftOffset + (crop.x / imageSize.width) * renderedWidth}%`,
    top: `${(crop.y / imageSize.height) * 100}%`,
    width: `${size}%`,
  }
}

function useGlobalInteractionFeedback() {
  useEffect(() => {
    const getFeedbackTarget = (eventTarget: EventTarget | null) => {
      const target = eventTarget instanceof Element ? eventTarget : null
      const interactiveElement = target?.closest<HTMLElement>(
        'button, a, [role="button"], [data-feedback-kind]',
      )

      if (!interactiveElement) {
        return null
      }

      if (
        interactiveElement.getAttribute('aria-disabled') === 'true' ||
        (interactiveElement instanceof HTMLButtonElement && interactiveElement.disabled)
      ) {
        return null
      }

      const feedbackKind = interactiveElement.dataset.feedbackKind

      if (feedbackKind === 'none') {
        return null
      }

      return {
        element: interactiveElement,
        kind: isInteractionFeedbackKind(feedbackKind) ? feedbackKind : 'button',
      }
    }

    const handleGlobalClick = (event: MouseEvent) => {
      const feedbackTarget = getFeedbackTarget(event.target)

      if (!feedbackTarget) {
        return
      }

      playInteractionFeedback(feedbackTarget.kind)
    }

    window.addEventListener('click', handleGlobalClick, { capture: true })

    return () => {
      window.removeEventListener('click', handleGlobalClick, { capture: true })
    }
  }, [])
}

function AppLayout() {
  const {
    isSessionUnlocked,
    isStoreReady,
    pet,
    meta,
    taskStats,
    levelUpCelebration,
    setProfileAvatar,
  } = usePetStore()
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const avatarCropStageRef = useRef<HTMLDivElement | null>(null)
  const avatarCropDragRef = useRef<AvatarCropDrag | null>(null)
  const [avatarCropSource, setAvatarCropSource] = useState('')
  const [avatarCropVersion, setAvatarCropVersion] = useState(0)
  const [avatarCropImageSize, setAvatarCropImageSize] = useState<AvatarImageSize | null>(null)
  const [avatarCropSelection, setAvatarCropSelection] = useState<AvatarCropSelection | null>(null)
  const titleName = pet.name.trim() || '小猫'
  const companionName = meta.userName.trim() || '你'

  useEffect(() => {
    document.title = `${titleName}成长记`
  }, [titleName])

  if (!isStoreReady || !isSessionUnlocked) {
    return <AuthGate />
  }

  const handleAvatarPick = () => {
    avatarInputRef.current?.click()
  }

  const closeAvatarCropper = () => {
    avatarCropDragRef.current = null
    setAvatarCropSource('')
    setAvatarCropImageSize(null)
    setAvatarCropSelection(null)
  }

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result

      if (typeof result === 'string') {
        avatarCropDragRef.current = null
        setAvatarCropVersion((currentVersion) => currentVersion + 1)
        setAvatarCropSource(result)
        setAvatarCropImageSize(null)
        setAvatarCropSelection(null)
      }
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  const handleAvatarCropImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalHeight, naturalWidth } = event.currentTarget

    if (!naturalHeight || !naturalWidth) {
      return
    }

    const nextImageSize = {
      height: naturalHeight,
      width: naturalWidth,
    }

    setAvatarCropImageSize(nextImageSize)
    setAvatarCropSelection(createAvatarCropSelection(nextImageSize))
  }

  const handleAvatarCropPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!avatarCropImageSize || !avatarCropSelection || !avatarCropStageRef.current) {
      return
    }

    const scale = getAvatarRenderedScale(avatarCropStageRef.current, avatarCropImageSize)

    if (!scale) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    avatarCropDragRef.current = {
      pointerId: event.pointerId,
      scale,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCrop: avatarCropSelection,
    }
  }

  const handleAvatarCropPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = avatarCropDragRef.current

    if (!drag || !avatarCropImageSize || drag.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()

    const nextX = drag.startCrop.x + (event.clientX - drag.startClientX) / drag.scale
    const nextY = drag.startCrop.y + (event.clientY - drag.startClientY) / drag.scale

    setAvatarCropSelection({
      size: drag.startCrop.size,
      x: clamp(nextX, 0, avatarCropImageSize.width - drag.startCrop.size),
      y: clamp(nextY, 0, avatarCropImageSize.height - drag.startCrop.size),
    })
  }

  const handleAvatarCropPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = avatarCropDragRef.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    avatarCropDragRef.current = null

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleAvatarCropKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!avatarCropImageSize || !avatarCropSelection) {
      return
    }

    const moveAmount = event.shiftKey ? 20 : 5
    let deltaX = 0
    let deltaY = 0

    if (event.key === 'ArrowLeft') {
      deltaX = -moveAmount
    } else if (event.key === 'ArrowRight') {
      deltaX = moveAmount
    } else if (event.key === 'ArrowUp') {
      deltaY = -moveAmount
    } else if (event.key === 'ArrowDown') {
      deltaY = moveAmount
    } else {
      return
    }

    event.preventDefault()
    setAvatarCropSelection((currentSelection) => {
      if (!currentSelection) {
        return currentSelection
      }

      return {
        ...currentSelection,
        x: clamp(currentSelection.x + deltaX, 0, avatarCropImageSize.width - currentSelection.size),
        y: clamp(currentSelection.y + deltaY, 0, avatarCropImageSize.height - currentSelection.size),
      }
    })
  }

  const handleAvatarCropSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!avatarCropImageSize) {
      return
    }

    const { max, min } = getAvatarCropLimits(avatarCropImageSize)
    const nextSize = clamp(Number(event.target.value), min, max)

    setAvatarCropSelection((currentSelection) => {
      if (!currentSelection) {
        return currentSelection
      }

      const centerX = currentSelection.x + currentSelection.size / 2
      const centerY = currentSelection.y + currentSelection.size / 2

      return {
        size: nextSize,
        x: clamp(centerX - nextSize / 2, 0, avatarCropImageSize.width - nextSize),
        y: clamp(centerY - nextSize / 2, 0, avatarCropImageSize.height - nextSize),
      }
    })
  }

  const handleAvatarCropSave = () => {
    if (!avatarCropSelection || !avatarCropSource) {
      return
    }

    const image = new Image()

    image.onload = () => {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')

      if (!context) {
        return
      }

      canvas.width = AVATAR_OUTPUT_SIZE
      canvas.height = AVATAR_OUTPUT_SIZE
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(
        image,
        avatarCropSelection.x,
        avatarCropSelection.y,
        avatarCropSelection.size,
        avatarCropSelection.size,
        0,
        0,
        AVATAR_OUTPUT_SIZE,
        AVATAR_OUTPUT_SIZE,
      )
      setProfileAvatar(canvas.toDataURL('image/jpeg', 0.9))
      closeAvatarCropper()
    }
    image.src = avatarCropSource
  }

  const avatarCropLimits = avatarCropImageSize ? getAvatarCropLimits(avatarCropImageSize) : null

  return (
    <div className="app-shell">
      {levelUpCelebration ? (
        <LevelUpCelebration
          key={levelUpCelebration.token}
          level={levelUpCelebration.level}
        />
      ) : null}

      {avatarCropSource ? (
        <div className="avatar-crop-modal" role="dialog" aria-label="调整头像" aria-modal="true">
          <div className="avatar-crop-sheet">
            <strong className="avatar-crop-sheet__title">调整头像</strong>
            <div className="avatar-crop-stage" ref={avatarCropStageRef}>
              <img
                alt=""
                className="avatar-crop-stage__image"
                key={avatarCropVersion}
                onLoad={handleAvatarCropImageLoad}
                src={avatarCropSource}
              />
              {avatarCropImageSize && avatarCropSelection ? (
                <div
                  aria-label="移动裁剪框"
                  className="avatar-crop-box"
                  onKeyDown={handleAvatarCropKeyDown}
                  onPointerCancel={handleAvatarCropPointerEnd}
                  onPointerDown={handleAvatarCropPointerDown}
                  onPointerMove={handleAvatarCropPointerMove}
                  onPointerUp={handleAvatarCropPointerEnd}
                  role="button"
                  style={getAvatarCropStyle(avatarCropSelection, avatarCropImageSize)}
                  tabIndex={0}
                />
              ) : null}
            </div>

            {avatarCropLimits && avatarCropSelection ? (
              <label className="avatar-crop-control">
                <span>范围</span>
                <input
                  max={avatarCropLimits.max}
                  min={avatarCropLimits.min}
                  onChange={handleAvatarCropSizeChange}
                  type="range"
                  value={avatarCropSelection.size}
                />
              </label>
            ) : null}

            <div className="avatar-crop-actions">
              <button className="ghost-button" onClick={handleAvatarPick} type="button">
                重选
              </button>
              <button className="ghost-button" onClick={closeAvatarCropper} type="button">
                取消
              </button>
              <button
                className="primary-button"
                disabled={!avatarCropSelection}
                onClick={handleAvatarCropSave}
                type="button"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <header className="app-header">
        <div className="app-header__main">
          <button
            aria-label={meta.profileAvatar ? '修改头像' : '上传头像'}
            className={`profile-avatar ${meta.profileAvatar ? 'profile-avatar--filled' : ''}`}
            onClick={handleAvatarPick}
            type="button"
          >
            {meta.profileAvatar ? (
              <img alt="小朋友头像" className="profile-avatar__image" src={meta.profileAvatar} />
            ) : (
              <span className="profile-avatar__placeholder" aria-hidden="true">
                🧒
              </span>
            )}
          </button>

          <input
            accept="image/*"
            className="profile-avatar__input"
            onChange={handleAvatarChange}
            ref={avatarInputRef}
            type="file"
          />

          <div className="app-header__intro">
            <div className="app-header__topline">
              <p className="eyebrow">
                儿童互动电子宠物 v<span className="app-version-number">0.0.6</span>
              </p>
              <p className="app-header__meta app-header__meta--mobile">
                连续 {meta.streakCount} 天 · 完成 {taskStats.done}/{taskStats.total}
              </p>
            </div>
            <div className="app-header__title-row">
              <h1>{titleName}成长记</h1>
              <p className="header-copy">
                陪着 {companionName} 一起做任务、拿积分、慢慢长大。
              </p>
            </div>
          </div>
        </div>
        <p className="app-header__meta app-header__meta--desktop">
          连续 {meta.streakCount} 天 · 完成 {taskStats.done}/{taskStats.total}
        </p>
      </header>

      <main className="page-container">
        <Routes>
          <Route element={<Home />} path="/" />
          <Route element={<Tasks />} path="/tasks" />
          <Route element={<Shop />} path="/shop" />
          <Route element={<Inventory />} path="/inventory" />
          <Route element={<Growth />} path="/growth" />
          <Route element={<Navigate replace to="/" />} path="*" />
        </Routes>
      </main>

      <BottomNav />
    </div>
  )
}

export default function App() {
  useGlobalInteractionFeedback()

  return (
    <ToastProvider>
      <PetProvider>
        <AppUpdatePrompt />
        <AppLayout />
      </PetProvider>
    </ToastProvider>
  )
}
