import { ActionButton } from '../components/ActionButton'
import { PetCard } from '../components/PetCard'
import { StatusBar } from '../components/StatusBar'
import { usePetStore } from '../hooks/usePetStore'

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
  const isSleeping = (meta.sleepEndAt ?? 0) > Date.now()

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
          <ActionButton disabled={isSleeping} feedbackKind="careAction" icon="😴" label="睡一觉" onClick={() => performCareAction('sleep')} variant="secondary" />
        </div>
      </section>
    </div>
  )
}
