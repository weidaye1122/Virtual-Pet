import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { SLEEP_DURATION_MS } from '../data/petTimings'
import type { FeedAnimationId, Pet, PetPosition } from '../types'
import { playInteractionFeedback } from '../utils/interactionFeedback'

type PetCardProps = {
  feedAnimationQueue?: FeedAnimationId[]
  hatIcon?: string
  onFeedAnimationComplete?: () => void
  onPetPositionChange?: (position: PetPosition) => void
  pet: Pet
  petPosition: PetPosition
  scarfIcon?: string
  sleepEndAt?: number
  sleepStartedAt?: number
  shoesIcon?: string
}

type MotionStep = {
  duration: number
  source: string
}

type ClipStepOptions = {
  leadHold?: number
  trailHold?: number
}

type FrameLoader = () => Promise<string>

type FeedMotionConfig = {
  duration: number
  loaders: FrameLoader[]
  options?: ClipStepOptions
}

const frameSorter = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
const emptyMotionSteps: MotionStep[] = []
const minimumPetPosition: PetPosition = { x: 0.04, y: 0.32 }
const maximumPetPosition: PetPosition = { x: 0.96, y: 0.96 }

const clampPositionValue = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const normalizePetPosition = (position: PetPosition): PetPosition => ({
  x: clampPositionValue(position.x, minimumPetPosition.x, maximumPetPosition.x),
  y: clampPositionValue(position.y, minimumPetPosition.y, maximumPetPosition.y),
})

const getPetDepthScale = (positionY: number) => {
  const depth =
    (clampPositionValue(positionY, minimumPetPosition.y, maximumPetPosition.y) -
      minimumPetPosition.y) /
    (maximumPetPosition.y - minimumPetPosition.y)

  return 0.62 + depth * 0.56
}

const sortFrameLoaders = (frames: Record<string, FrameLoader>) =>
  Object.entries(frames)
    .sort(([frameA], [frameB]) => frameSorter.compare(frameA, frameB))
    .map(([, loader]) => loader)

const loadFrameSources = (loaders: FrameLoader[]) => Promise.all(loaders.map((loader) => loader()))

const createHoldSteps = (source: string | undefined, count: number, duration: number) =>
  source ? Array.from({ length: count }, () => ({ duration, source })) : []

const createClipSteps = (
  sources: string[],
  duration: number,
  options?: ClipStepOptions,
): MotionStep[] => {
  if (!sources.length) {
    return []
  }

  const firstFrame = sources[0]
  const lastFrame = sources.at(-1)

  return [
    ...createHoldSteps(firstFrame, options?.leadHold ?? 0, duration),
    ...sources.map((source) => ({ duration, source })),
    ...createHoldSteps(lastFrame, options?.trailHold ?? 0, duration),
  ]
}

const blinkTailFrameLoaders = sortFrameLoaders(
  import.meta.glob('../../图片/01眨眼睛甩尾巴/*.webp', {
    import: 'default',
  }) as Record<string, FrameLoader>,
)

const sleepFrameLoaders = sortFrameLoaders(
  import.meta.glob('../../图片/02 趴着睡觉/*.webp', {
    import: 'default',
  }) as Record<string, FrameLoader>,
)

const lickPawFrameLoaders = sortFrameLoaders(
  import.meta.glob('../../图片/03 舔爪子/*.webp', {
    import: 'default',
  }) as Record<string, FrameLoader>,
)

const catFoodFrameLoaders = sortFrameLoaders(
  import.meta.glob('../../图片/05 吃猫粮/*.webp', {
    import: 'default',
  }) as Record<string, FrameLoader>,
)

const candyFrameLoaders = sortFrameLoaders(
  import.meta.glob('../../图片/06 吃棒棒糖/*.webp', {
    import: 'default',
  }) as Record<string, FrameLoader>,
)

const milkFrameLoaders = sortFrameLoaders(
  import.meta.glob('../../图片/07 喝牛奶/*.webp', {
    import: 'default',
  }) as Record<string, FrameLoader>,
)

const fishSnackFrameLoaders = sortFrameLoaders(
  import.meta.glob('../../图片/08 吃小鱼干/*.webp', {
    import: 'default',
  }) as Record<string, FrameLoader>,
)

const bodyWashFrameLoaders = sortFrameLoaders(
  import.meta.glob('../../图片/11 洗一洗/*.webp', {
    import: 'default',
  }) as Record<string, FrameLoader>,
)

const yarnBallFrameLoaders = sortFrameLoaders(
  import.meta.glob('../../图片/09玩毛线球/*.webp', {
    import: 'default',
  }) as Record<string, FrameLoader>,
)

const featherWandFrameLoaders = sortFrameLoaders(
  import.meta.glob('../../图片/10魔法棒/*.webp', {
    import: 'default',
  }) as Record<string, FrameLoader>,
)

const feedMotionConfigById: Record<FeedAnimationId, FeedMotionConfig> = {
  'cat-food': {
    duration: 125,
    loaders: catFoodFrameLoaders,
    options: { leadHold: 1, trailHold: 2 },
  },
  'canned-food': {
    duration: 135,
    loaders: candyFrameLoaders,
    options: { leadHold: 1, trailHold: 2 },
  },
  milk: {
    duration: 130,
    loaders: milkFrameLoaders,
    options: { leadHold: 1, trailHold: 2 },
  },
  'fish-snack': {
    duration: 125,
    loaders: fishSnackFrameLoaders,
    options: { leadHold: 1, trailHold: 2 },
  },
  'body-wash': {
    duration: 140,
    loaders: bodyWashFrameLoaders,
    options: { leadHold: 1, trailHold: 2 },
  },
  'yarn-ball': {
    duration: 130,
    loaders: yarnBallFrameLoaders,
    options: { leadHold: 1, trailHold: 2 },
  },
  'feather-wand': {
    duration: 130,
    loaders: featherWandFrameLoaders,
    options: { leadHold: 1, trailHold: 2 },
  },
}

const getMotionStepAtElapsed = (steps: MotionStep[], elapsed: number) => {
  if (!steps.length) {
    return null
  }

  let remainingElapsed = Math.max(0, elapsed)

  for (const [index, step] of steps.entries()) {
    if (remainingElapsed < step.duration) {
      return {
        index,
        remaining: step.duration - remainingElapsed,
      }
    }

    remainingElapsed -= step.duration
  }

  return {
    index: steps.length - 1,
    remaining: null,
  }
}

const getSleepElapsed = (sleepEndAt: number | undefined, sleepStartedAt: number | undefined) => {
  const fallbackSleepStartedAt = sleepEndAt ? sleepEndAt - SLEEP_DURATION_MS : Date.now()
  const activeSleepStartedAt =
    typeof sleepStartedAt === 'number' && sleepStartedAt > 0
      ? sleepStartedAt
      : fallbackSleepStartedAt

  return Date.now() - activeSleepStartedAt
}

const AnimatedPetArt = ({
  feedAnimationQueue = [],
  onFeedAnimationComplete,
  sleepEndAt,
  sleepStartedAt,
}: Pick<
  PetCardProps,
  'feedAnimationQueue' | 'onFeedAnimationComplete' | 'sleepEndAt' | 'sleepStartedAt'
>) => {
  const isSleeping = Boolean(sleepEndAt && sleepEndAt > Date.now())
  const [defaultMotionSteps, setDefaultMotionSteps] = useState<MotionStep[]>(emptyMotionSteps)
  const [sleepMotionSteps, setSleepMotionSteps] = useState<MotionStep[]>(emptyMotionSteps)
  const [feedMotionStepsById, setFeedMotionStepsById] = useState<
    Partial<Record<FeedAnimationId, MotionStep[]>>
  >({})
  const [feedFallbackFrameById, setFeedFallbackFrameById] = useState<
    Partial<Record<FeedAnimationId, string>>
  >({})
  const [defaultPlaybackIndex, setDefaultPlaybackIndex] = useState(0)
  const [sleepPlaybackIndex, setSleepPlaybackIndex] = useState(0)
  const [feedPlaybackIndex, setFeedPlaybackIndex] = useState(0)
  const [completedFeedToken, setCompletedFeedToken] = useState('')
  const [preparedFeedToken, setPreparedFeedToken] = useState('')
  const announcedFeedTokenRef = useRef('')

  const activeFeedAnimationId = !isSleeping ? feedAnimationQueue[0] : undefined
  const activeFeedSteps = activeFeedAnimationId
    ? (feedMotionStepsById[activeFeedAnimationId] ?? emptyMotionSteps)
    : emptyMotionSteps
  const hasLoadedActiveFeedSteps = Boolean(
    activeFeedAnimationId && feedMotionStepsById[activeFeedAnimationId],
  )
  const activeFeedToken = activeFeedAnimationId ? feedAnimationQueue.join('|') : ''

  const advanceDefaultFrame = useEffectEvent(() => {
    setDefaultPlaybackIndex((currentFrame) => (currentFrame + 1) % defaultMotionSteps.length)
  })

  const finishFeedAnimation = useEffectEvent(() => {
    if (!activeFeedToken) {
      return
    }

    setCompletedFeedToken(activeFeedToken)
    onFeedAnimationComplete?.()
  })

  useEffect(() => {
    let isCancelled = false

    const loadDefaultFrames = async () => {
      const [blinkTailFrameSources, lickPawFrameSources] = await Promise.all([
        loadFrameSources(blinkTailFrameLoaders),
        loadFrameSources(lickPawFrameLoaders),
      ])

      if (isCancelled) {
        return
      }

      const blinkTailMotionSteps = createClipSteps(blinkTailFrameSources, 110, {
        leadHold: 10,
      })
      const lickPawMotionSteps = createClipSteps(lickPawFrameSources, 185, {
        leadHold: 1,
        trailHold: 3,
      })

      setDefaultMotionSteps([
        ...blinkTailMotionSteps,
        ...blinkTailMotionSteps,
        ...lickPawMotionSteps,
      ])
    }

    void loadDefaultFrames()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isSleeping || sleepMotionSteps.length) {
      return
    }

    let isCancelled = false

    const loadSleepFrames = async () => {
      const sleepFrameSources = await loadFrameSources(sleepFrameLoaders)

      if (!isCancelled) {
        setSleepMotionSteps(createClipSteps(sleepFrameSources, 176))
      }
    }

    void loadSleepFrames()

    return () => {
      isCancelled = true
    }
  }, [isSleeping, sleepMotionSteps.length])

  useEffect(() => {
    if (!activeFeedAnimationId || hasLoadedActiveFeedSteps) {
      return
    }

    let isCancelled = false
    const motionConfig = feedMotionConfigById[activeFeedAnimationId]

    const loadFeedFrames = async () => {
      const frameSources = await loadFrameSources(motionConfig.loaders)

      if (isCancelled) {
        return
      }

      setFeedMotionStepsById((current) => ({
        ...current,
        [activeFeedAnimationId]: createClipSteps(
          frameSources,
          motionConfig.duration,
          motionConfig.options,
        ),
      }))
      setFeedFallbackFrameById((current) => ({
        ...current,
        [activeFeedAnimationId]: frameSources.at(-1) ?? frameSources[0],
      }))
    }

    void loadFeedFrames()

    return () => {
      isCancelled = true
    }
  }, [activeFeedAnimationId, hasLoadedActiveFeedSteps])

  useEffect(() => {
    if (isSleeping && sleepEndAt) {
      const activeSleepStep = getMotionStepAtElapsed(
        sleepMotionSteps,
        getSleepElapsed(sleepEndAt, sleepStartedAt),
      )

      setSleepPlaybackIndex(activeSleepStep?.index ?? 0)
      return
    }

    setSleepPlaybackIndex(0)
    setDefaultPlaybackIndex(0)
  }, [isSleeping, sleepEndAt, sleepStartedAt, sleepMotionSteps])

  useEffect(() => {
    setFeedPlaybackIndex(0)
    setCompletedFeedToken('')
    setPreparedFeedToken(activeFeedToken)

    if (!activeFeedToken) {
      announcedFeedTokenRef.current = ''
    }
  }, [activeFeedToken])

  useEffect(() => {
    if (
      isSleeping ||
      !activeFeedAnimationId ||
      !hasLoadedActiveFeedSteps ||
      !activeFeedSteps.length ||
      preparedFeedToken !== activeFeedToken ||
      completedFeedToken === activeFeedToken ||
      announcedFeedTokenRef.current === activeFeedToken
    ) {
      return
    }

    announcedFeedTokenRef.current = activeFeedToken
    playInteractionFeedback('cat')
  }, [
    activeFeedAnimationId,
    activeFeedSteps.length,
    activeFeedToken,
    completedFeedToken,
    hasLoadedActiveFeedSteps,
    isSleeping,
    preparedFeedToken,
  ])

  useEffect(() => {
    if (isSleeping || activeFeedAnimationId) {
      setDefaultPlaybackIndex(0)
    }
  }, [activeFeedAnimationId, isSleeping])

  useEffect(() => {
    if (isSleeping || activeFeedAnimationId || defaultMotionSteps.length < 2) {
      return
    }

    const currentDefaultStep = defaultMotionSteps[defaultPlaybackIndex] ?? defaultMotionSteps[0]

    if (!currentDefaultStep) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      advanceDefaultFrame()
    }, currentDefaultStep.duration)

    return () => window.clearTimeout(timeoutId)
  }, [activeFeedAnimationId, defaultMotionSteps, defaultPlaybackIndex, isSleeping])

  useEffect(() => {
    if (!isSleeping || !sleepEndAt || sleepMotionSteps.length < 2) {
      return
    }

    const activeSleepStep = getMotionStepAtElapsed(
      sleepMotionSteps,
      getSleepElapsed(sleepEndAt, sleepStartedAt),
    )

    if (!activeSleepStep) {
      return
    }

    if (activeSleepStep.index !== sleepPlaybackIndex) {
      setSleepPlaybackIndex(activeSleepStep.index)
      return
    }

    if (activeSleepStep.remaining == null) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setSleepPlaybackIndex((currentFrame) =>
        Math.min(currentFrame + 1, sleepMotionSteps.length - 1),
      )
    }, activeSleepStep.remaining)

    return () => window.clearTimeout(timeoutId)
  }, [isSleeping, sleepEndAt, sleepStartedAt, sleepMotionSteps, sleepPlaybackIndex])

  useEffect(() => {
    if (
      isSleeping ||
      !activeFeedAnimationId ||
      !hasLoadedActiveFeedSteps ||
      preparedFeedToken !== activeFeedToken ||
      completedFeedToken === activeFeedToken
    ) {
      return
    }

    if (!activeFeedSteps.length) {
      finishFeedAnimation()
      return
    }

    const currentFeedStep = activeFeedSteps[feedPlaybackIndex] ?? activeFeedSteps.at(-1)

    if (!currentFeedStep) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      if (feedPlaybackIndex >= activeFeedSteps.length - 1) {
        finishFeedAnimation()
        return
      }

      setFeedPlaybackIndex((currentFrame) =>
        Math.min(currentFrame + 1, activeFeedSteps.length - 1),
      )
    }, currentFeedStep.duration)

    return () => window.clearTimeout(timeoutId)
  }, [
    activeFeedAnimationId,
    activeFeedSteps,
    activeFeedToken,
    completedFeedToken,
    feedPlaybackIndex,
    hasLoadedActiveFeedSteps,
    isSleeping,
    preparedFeedToken,
  ])

  const currentFrame = isSleeping
    ? sleepMotionSteps[sleepPlaybackIndex]?.source ??
      defaultMotionSteps[defaultPlaybackIndex]?.source ??
      defaultMotionSteps[0]?.source
    : activeFeedAnimationId
      ? activeFeedSteps[feedPlaybackIndex]?.source ??
        feedFallbackFrameById[activeFeedAnimationId] ??
        defaultMotionSteps[0]?.source
      : defaultMotionSteps[defaultPlaybackIndex]?.source ?? defaultMotionSteps[0]?.source
  const frameClassName = `pet-avatar__frame${
    activeFeedAnimationId === 'body-wash' ? ' pet-avatar__frame--wash' : ''
  }`

  if (!currentFrame) {
    return <span className="pet-avatar__empty">动作帧加载中</span>
  }

  return (
    <div className="pet-avatar__motion" aria-hidden="true">
      <img alt="" className={frameClassName} draggable="false" src={currentFrame} />
    </div>
  )
}

export const PetCard = ({
  feedAnimationQueue = [],
  hatIcon,
  onFeedAnimationComplete,
  onPetPositionChange,
  pet,
  petPosition,
  scarfIcon,
  sleepEndAt,
  sleepStartedAt,
  shoesIcon,
}: PetCardProps) => {
  const petName = pet.name.trim() || '小猫'
  const stageRef = useRef<HTMLButtonElement>(null)
  const dragStateRef = useRef<{
    hasMoved: boolean
    offsetX: number
    offsetY: number
    pointerId: number
    startClientX: number
    startClientY: number
  } | null>(null)
  const suppressNextClickRef = useRef(false)
  const [displayPosition, setDisplayPosition] = useState(() => normalizePetPosition(petPosition))
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (dragStateRef.current) {
      return
    }

    setDisplayPosition(normalizePetPosition(petPosition))
  }, [petPosition])

  const getPositionFromPointer = (
    event: ReactPointerEvent,
    offsetX: number,
    offsetY: number,
  ) => {
    const stageRect = stageRef.current?.getBoundingClientRect()

    if (!stageRect) {
      return displayPosition
    }

    return normalizePetPosition({
      x: (event.clientX - stageRect.left - offsetX) / stageRect.width,
      y: (event.clientY - stageRect.top - offsetY) / stageRect.height,
    })
  }

  const handlePetTap = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }

    playInteractionFeedback('cat')
  }

  const handleActorPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }

    const stageRect = stageRef.current?.getBoundingClientRect()

    if (!stageRect) {
      return
    }

    const normalizedPosition = normalizePetPosition(displayPosition)
    const anchorX = normalizedPosition.x * stageRect.width
    const anchorY = normalizedPosition.y * stageRect.height

    event.currentTarget.setPointerCapture(event.pointerId)
    dragStateRef.current = {
      hasMoved: false,
      offsetX: event.clientX - stageRect.left - anchorX,
      offsetY: event.clientY - stageRect.top - anchorY,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
    }
    setIsDragging(true)
  }

  const handleActorPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    const distance = Math.hypot(
      event.clientX - dragState.startClientX,
      event.clientY - dragState.startClientY,
    )

    if (distance > 4) {
      dragState.hasMoved = true
    }

    if (dragState.hasMoved) {
      setDisplayPosition(getPositionFromPointer(event, dragState.offsetX, dragState.offsetY))
    }
  }

  const handleActorPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    const nextPosition = getPositionFromPointer(event, dragState.offsetX, dragState.offsetY)

    if (dragState.hasMoved) {
      suppressNextClickRef.current = true
      setDisplayPosition(nextPosition)
      onPetPositionChange?.(nextPosition)
    }

    event.currentTarget.releasePointerCapture(event.pointerId)
    dragStateRef.current = null
    setIsDragging(false)
  }

  const petScale = getPetDepthScale(displayPosition.y)
  const petActorStyle = {
    '--pet-depth-scale': petScale,
    '--pet-x': `${displayPosition.x * 100}%`,
    '--pet-y': `${displayPosition.y * 100}%`,
  } as CSSProperties

  return (
    <section className={`pet-card pet-card--${pet.currentBackground || 'default'}`}>
      <button
        aria-label={`摸摸${petName}，也可以拖动摆放位置`}
        className="pet-avatar pet-avatar--interactive"
        data-feedback-kind="none"
        onClick={handlePetTap}
        ref={stageRef}
        type="button"
      >
        <div
          className={`pet-avatar__actor${isDragging ? ' pet-avatar__actor--dragging' : ''}`}
          onPointerCancel={handleActorPointerUp}
          onPointerDown={handleActorPointerDown}
          onPointerMove={handleActorPointerMove}
          onPointerUp={handleActorPointerUp}
          style={petActorStyle}
        >
          {hatIcon ? (
            <span className="pet-avatar__hat" aria-hidden="true">
              {hatIcon}
            </span>
          ) : null}
          {scarfIcon ? (
            <span className="pet-avatar__scarf" aria-hidden="true">
              {scarfIcon}
            </span>
          ) : null}
          {shoesIcon ? (
            <span className="pet-avatar__shoes" aria-hidden="true">
              {shoesIcon}
            </span>
          ) : null}
          <span className="pet-avatar__ground" aria-hidden="true" />
          <div className="pet-avatar__scene">
            <AnimatedPetArt
              feedAnimationQueue={feedAnimationQueue}
              onFeedAnimationComplete={onFeedAnimationComplete}
              sleepEndAt={sleepEndAt}
              sleepStartedAt={sleepStartedAt}
            />
          </div>
          <span className="pet-avatar__shadow" />
        </div>
      </button>
    </section>
  )
}
