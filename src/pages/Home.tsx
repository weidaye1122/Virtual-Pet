import { useEffect, useState } from 'react'
import { ActionButton } from '../components/ActionButton'
import { PetCard } from '../components/PetCard'
import { StatusBar } from '../components/StatusBar'
import { SLEEP_MAX_CLICK_COUNT } from '../data/petTimings'
import { usePetStore } from '../hooks/usePetStore'

const formatSleepCountdown = (remainingMs: number) => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export const Home = () => {
  const {
    inventory,
    meta,
    pet,
    shopItems,
    equippedHatItem,
    equippedScarfItem,
    equippedShoesItem,
    growthProgress,
    nextLevelRule,
    performCareAction,
    moodMax,
    consumeNextFeedAnimation,
    setPetPosition,
  } = usePetStore()
  const [now, setNow] = useState(() => Date.now())

  const sleepEndAt = meta.sleepEndAt ?? 0

  useEffect(() => {
    setNow(Date.now())

    if (!sleepEndAt || sleepEndAt <= Date.now()) {
      return
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [sleepEndAt])

  const getToyEnergyCost = (effect?: { energy?: number }) => Math.max(0, -(effect?.energy ?? 0))
  const hasConsumableByType = (type: 'food' | 'toy' | 'care') =>
    shopItems.some(
      (item) =>
        item.type === type &&
        (inventory.consumables[item.id] ?? 0) > 0 &&
        (type !== 'toy' || pet.energy >= getToyEnergyCost(item.effect)),
    )

  const canFeed = hasConsumableByType('food')
  const canWash = hasConsumableByType('care')
  const canPlay = hasConsumableByType('toy')
  const isSleeping = sleepEndAt > now
  const sleepClickCount = isSleeping
    ? Math.max(1, Math.min(SLEEP_MAX_CLICK_COUNT, meta.sleepClickCount ?? 0))
    : 0
  const sleepLimitReached = isSleeping && sleepClickCount >= SLEEP_MAX_CLICK_COUNT
  const sleepCountdownText = isSleeping ? formatSleepCountdown(sleepEndAt - now) : ''

  return (
    <div className="page-stack page-stack--home">
      <div className="two-column-grid">
        <PetCard
          feedAnimationQueue={meta.feedAnimationQueue}
          hatIcon={equippedHatItem?.icon}
          onFeedAnimationComplete={consumeNextFeedAnimation}
          onPetPositionChange={setPetPosition}
          pet={pet}
          petPosition={meta.petPosition}
          scarfIcon={equippedScarfItem?.icon}
          sleepEndAt={meta.sleepEndAt}
          sleepStartedAt={meta.sleepStartedAt}
          shoesIcon={equippedShoesItem?.icon}
        />

        <section className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">成长小目标</p>
              <h2>{nextLevelRule ? `下次升级还差 ${growthProgress.remaining} 点成长值` : '已经达到当前最高等级'}</h2>
            </div>
          </div>
          <div className="meter-card">
            <div className="meter-card__row">
              <strong className="meter-card__value-label">
                <span>成长值</span>
                <span>{pet.growthValue}</span>
              </strong>
              <span>{growthProgress.percentage}%</span>
            </div>
            <div className="progress-track">
              <span className="progress-fill progress-fill--orange" style={{ width: `${growthProgress.percentage}%` }} />
            </div>
            <p className="meter-card__hint meter-card__hint--single meter-card__hint--level">{`当前等级 Lv.${pet.level}`}</p>
          </div>

          <div className="status-grid status-grid--home">
            <StatusBar icon="🐟" label="饱腹值" tone="orange" value={pet.hunger} />
            <StatusBar icon="💗" label="心情值" maxValue={moodMax} tone="pink" value={pet.mood} />
            <StatusBar icon="🛁" label="清洁值" tone="blue" value={pet.clean} />
            <StatusBar icon="⚡" label="体力值" tone="green" value={pet.energy} />
          </div>
        </section>
      </div>

      <section className="home-actions-strip">
        <div className="button-grid home-actions-grid">
          <ActionButton disabled={!canFeed} feedbackKind="careAction" icon="🐟" label="喂一喂" onClick={() => performCareAction('feed')} variant="soft" />
          <ActionButton disabled={!canWash} feedbackKind="careAction" icon="🛁" label="洗一洗" onClick={() => performCareAction('wash')} variant="secondary" />
          <ActionButton disabled={!canPlay} feedbackKind="careAction" icon="🧶" label="玩一玩" onClick={() => performCareAction('play')} variant="soft" />
          <div className={`sleep-action${isSleeping ? ' sleep-action--active' : ''}`}>
            <ActionButton
              disabled={sleepLimitReached}
              feedbackKind="careAction"
              icon="😴"
              label="睡一觉"
              onClick={() => performCareAction('sleep')}
              variant="secondary"
            />
            {isSleeping ? (
              <span className="sleep-action__countdown" aria-live="polite">
                <span>睡觉倒计时</span>
                <strong>{sleepCountdownText}</strong>
                <span>{sleepClickCount}/10</span>
              </span>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
