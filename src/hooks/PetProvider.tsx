import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { defaultInventory } from '../data/defaultInventory'
import { createDefaultMeta } from '../data/defaultMeta'
import { feedAnimationOrder, playAnimationOrder } from '../data/feedAnimationConfig'
import { defaultPet } from '../data/defaultPet'
import { defaultShopItems } from '../data/defaultShopItems'
import { defaultTasks } from '../data/defaultTasks'
import { SLEEP_DURATION_MS, SLEEP_MAX_CLICK_COUNT } from '../data/petTimings'
import { levelRules } from '../data/levelRules'
import type {
  AppMeta,
  FeedAnimationId,
  FeedCycleAnimationId,
  InventoryState,
  NewTaskInput,
  Pet,
  PetPosition,
  PetStatChanges,
  PersistedAppState,
  PlayCycleAnimationId,
  PointRecord,
  ShopItem,
  Task,
  TaskStats,
  WearableSlot,
} from '../types'
import { getDayDifference, getLocalDateKey } from '../utils/date'
import {
  calculateLevelFromGrowth,
  getGrowthProgress,
  getNextLevelRule,
  getStageForLevel,
} from '../utils/level'
import {
  clearLocalAppState,
  loadLocalAppState,
  loadRemoteAppState,
  loadSessionUnlock,
  saveLocalAppState,
  saveRemoteAppState,
  saveSessionUnlock,
} from '../utils/storage'
import { PetStoreContext } from './petStoreContext'
import type { FirstRunSetupInput, LevelUpCelebrationState } from './petStoreContext'
import { useToast } from './useToast'

type PetStoreData = {
  pet: Pet
  tasks: Task[]
  shopItems: ShopItem[]
  inventory: InventoryState
  pointRecords: PointRecord[]
  meta: AppMeta
}

const cloneData = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const HUNGER_DECAY_MS = 2 * 60 * 60 * 1000
const HUNGER_DECAY_VALUE = 6
const CLEAN_DECAY_MS = 3 * 60 * 60 * 1000
const CLEAN_DECAY_VALUE = 5
const ENERGY_DECAY_MS = 2 * 60 * 60 * 1000
const ENERGY_DECAY_VALUE = 4
const NEED_MOOD_DECAY_THRESHOLD = 50
const LOW_NEED_MOOD_DECAY_MS = 3 * 60 * 60 * 1000
const LOW_NEED_MOOD_DECAY_VALUE = 5
const PLAY_MOOD_STAGE_ONE_MS = 8 * 60 * 60 * 1000
const PLAY_MOOD_STAGE_TWO_MS = 16 * 60 * 60 * 1000
const PLAY_MOOD_STAGE_ONE_VALUE = 8
const PLAY_MOOD_STAGE_TWO_VALUE = 10
const SLEEP_ENERGY_RECOVERY_VALUE = 10
const SLEEP_ENERGY_RECOVERY_TICK_MS = Math.max(
  1000,
  Math.floor(SLEEP_DURATION_MS / SLEEP_ENERGY_RECOVERY_VALUE),
)
const REMOTE_AVATAR_SYNC_MS = 15_000
const removedShopItemIds = new Set([
  'pumpkin',
  'chicken',
  'toothbrush',
  'shampoo',
  'bath-towel',
  'berry-scarf',
  'laser-pointer',
  'paper-box',
])
const feedCycleAnimationIdSet = new Set<FeedCycleAnimationId>(feedAnimationOrder)
const playCycleAnimationIdSet = new Set<PlayCycleAnimationId>(playAnimationOrder)
const queuedConsumableAnimationIdSet = new Set<FeedAnimationId>([
  ...feedAnimationOrder,
  'body-wash',
  'yarn-ball',
  'feather-wand',
])
let shouldOverwriteRemoteOnNextHydration = false

const clampStat = (value: number, max = 100) => Math.max(0, Math.min(max, Math.round(value)))
const clampRatio = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))
const normalizeSleepClickCount = (value: number | undefined) =>
  Math.max(
    0,
    Math.min(SLEEP_MAX_CLICK_COUNT, Number.isFinite(value) ? Math.floor(value ?? 0) : 0),
  )
const normalizeSleepRecoveredEnergy = (value: number | undefined) =>
  Math.max(0, Number.isFinite(value) ? Math.floor(value ?? 0) : 0)
const getMoodMax = (_pet: Pet) => 100
const normalizePetPosition = (position: Partial<PetPosition> | undefined): PetPosition => ({
  x: clampRatio(typeof position?.x === 'number' ? position.x : 0.5, 0.04, 0.96),
  y: clampRatio(typeof position?.y === 'number' ? position.y : 0.78, 0.32, 0.96),
})
const isConsumableItemType = (type: ShopItem['type']): type is 'food' | 'toy' | 'care' =>
  type === 'food' || type === 'toy' || type === 'care'
const isQueuedConsumableAnimationId = (itemId: string): itemId is FeedAnimationId =>
  queuedConsumableAnimationIdSet.has(itemId as FeedAnimationId)
const sanitizeFeedAnimationQueue = (queue: AppMeta['feedAnimationQueue'] | undefined) =>
  Array.isArray(queue)
    ? queue.filter((itemId): itemId is FeedAnimationId => isQueuedConsumableAnimationId(itemId))
    : []
const getLastFeedCycleItemId = (
  itemId: AppMeta['lastFeedCycleItemId'] | undefined,
): FeedCycleAnimationId | '' =>
  itemId && feedCycleAnimationIdSet.has(itemId as FeedCycleAnimationId)
    ? (itemId as FeedCycleAnimationId)
    : ''
const getLastPlayCycleItemId = (
  itemId: AppMeta['lastPlayCycleItemId'] | undefined,
): PlayCycleAnimationId | '' =>
  itemId && playCycleAnimationIdSet.has(itemId as PlayCycleAnimationId)
    ? (itemId as PlayCycleAnimationId)
    : ''
const getFirstAvailableConsumableItem = (
  current: PetStoreData,
  type: 'food' | 'toy' | 'care',
) =>
  current.shopItems.find(
    (item) => item.type === type && (current.inventory.consumables[item.id] ?? 0) > 0,
  )
const getConsumableEnergyCost = (item: ShopItem) =>
  item.type === 'toy' ? Math.max(0, -(item.effect?.energy ?? 0)) : 0
const canUseConsumableItem = (pet: Pet, item: ShopItem) => pet.energy >= getConsumableEnergyCost(item)
const shouldRestoreSessionUnlock = (meta: AppMeta) =>
  Boolean(meta.passwordHash && loadSessionUnlock() === meta.passwordHash)
const isCustomTask = (taskId: string) => taskId.startsWith('custom-')
const getProfileAvatarUpdatedAt = (meta: AppMeta) =>
  typeof meta.profileAvatarUpdatedAt === 'number' ? meta.profileAvatarUpdatedAt : meta.profileAvatar ? 1 : 0
const normalizeRewardValue = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.max(1, Math.round(value))
}
const getNextFeedCycleItem = (current: PetStoreData) => {
  const availableFeedIds = feedAnimationOrder.filter(
    (itemId) => (current.inventory.consumables[itemId] ?? 0) > 0,
  )

  if (!availableFeedIds.length) {
    return undefined
  }

  const availableFeedIdSet = new Set(availableFeedIds)
  const lastFeedCycleItemId = getLastFeedCycleItemId(current.meta.lastFeedCycleItemId)
  const startIndex = lastFeedCycleItemId ? feedAnimationOrder.indexOf(lastFeedCycleItemId) : -1

  for (let step = 1; step <= feedAnimationOrder.length; step += 1) {
    const candidateId =
      feedAnimationOrder[(startIndex + step + feedAnimationOrder.length) % feedAnimationOrder.length]

    if (!availableFeedIdSet.has(candidateId)) {
      continue
    }

    return current.shopItems.find((item) => item.id === candidateId)
  }

  return current.shopItems.find((item) => item.id === availableFeedIds[0])
}
const getNextPlayCycleItem = (current: PetStoreData) => {
  const availableToyIds = playAnimationOrder.filter((itemId) => {
    const item = current.shopItems.find((shopItem) => shopItem.id === itemId)

    return Boolean(
      item &&
        (current.inventory.consumables[itemId] ?? 0) > 0 &&
        canUseConsumableItem(current.pet, item),
    )
  })

  if (!availableToyIds.length) {
    return undefined
  }

  const availableToyIdSet = new Set(availableToyIds)
  const lastPlayCycleItemId = getLastPlayCycleItemId(current.meta.lastPlayCycleItemId)
  const startIndex = lastPlayCycleItemId ? playAnimationOrder.indexOf(lastPlayCycleItemId) : -1

  for (let step = 1; step <= playAnimationOrder.length; step += 1) {
    const candidateId =
      playAnimationOrder[(startIndex + step + playAnimationOrder.length) % playAnimationOrder.length]

    if (!availableToyIdSet.has(candidateId)) {
      continue
    }

    return current.shopItems.find((item) => item.id === candidateId)
  }

  return current.shopItems.find((item) => item.id === availableToyIds[0])
}

const createOperationId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`
const createPointRecord = (
  title: string,
  change: number,
  options: Omit<Partial<PointRecord>, 'id' | 'title' | 'change' | 'createdAt'> = {},
): PointRecord => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  title,
  change,
  createdAt: new Date().toISOString(),
  ...options,
})

const getPetStatChanges = (before: Pet, after: Pet): PetStatChanges => {
  const changes: PetStatChanges = {}
  const statKeys: Array<keyof PetStatChanges> = ['hunger', 'mood', 'clean', 'energy']

  statKeys.forEach((key) => {
    const change = (after[key] ?? 0) - (before[key] ?? 0)

    if (change !== 0) {
      changes[key] = change
    }
  })

  return changes
}

const hasPetStatChanges = (changes: PetStatChanges | undefined) =>
  Boolean(changes && Object.values(changes).some((change) => change !== 0))

const normalizePet = (pet: Pet): Pet => {
  const growthValue = Math.max(0, Math.round(pet.growthValue))
  const level = calculateLevelFromGrowth(growthValue, levelRules)
  const normalizedPet = {
    ...pet,
    level,
    growthValue,
    stage: getStageForLevel(level).name,
    points: Math.max(0, Math.round(pet.points)),
    hunger: clampStat(pet.hunger),
    clean: clampStat(pet.clean),
    energy: clampStat(pet.energy),
    currentHat: pet.currentHat ?? '',
    currentScarf: pet.currentScarf ?? '',
    currentShoes: pet.currentShoes ?? '',
    currentBackground: pet.currentBackground || 'default',
  }
  const moodMax = getMoodMax(normalizedPet as Pet)

  return {
    ...(normalizedPet as Pet),
    mood: clampStat(pet.mood, moodMax),
  }
}

const normalizeShopItemsData = (items: ShopItem[]) => {
  const currentById = new Map(items.map((item) => [item.id, item]))
  const normalizedDefaults = defaultShopItems.map((defaultItem) => {
    const currentItem = currentById.get(defaultItem.id)

    if (!currentItem) {
      return defaultItem
    }

    return {
      ...defaultItem,
      owned: currentItem.owned,
    }
  })

  const knownIds = new Set(defaultShopItems.map((item) => item.id))
  const customItems = items.filter(
    (item) => !knownIds.has(item.id) && !removedShopItemIds.has(item.id),
  )

  return [...normalizedDefaults, ...customItems]
}

const normalizeInventoryData = (
  inventory: InventoryState | undefined,
  shopItems: ShopItem[],
): InventoryState => {
  const validItemIds = new Set(shopItems.map((item) => item.id))
  const validConsumableIds = new Set(
    shopItems.filter((item) => isConsumableItemType(item.type)).map((item) => item.id),
  )

  return {
    consumables: Object.fromEntries(
      Object.entries(inventory?.consumables ?? {}).filter(
        ([itemId, quantity]) =>
          validConsumableIds.has(itemId) && typeof quantity === 'number' && quantity > 0,
      ),
    ),
    ownedItemIds: Array.from(
      new Set((inventory?.ownedItemIds ?? []).filter((itemId) => validItemIds.has(itemId))),
    ),
  }
}

const normalizePetSelections = (
  pet: Pet,
  inventory: InventoryState,
  shopItems: ShopItem[],
): Pet => {
  const ownedItemIds = new Set(inventory.ownedItemIds)
  const itemById = new Map(shopItems.map((item) => [item.id, item]))
  const normalizeWearableId = (itemId: string | undefined, wearableSlot: WearableSlot) => {
    if (!itemId || !ownedItemIds.has(itemId)) {
      return ''
    }

    const item = itemById.get(itemId)

    return item?.type === 'clothing' && item.wearableSlot === wearableSlot ? item.id : ''
  }
  const currentBackground =
    pet.currentBackground &&
    pet.currentBackground !== 'default' &&
    ownedItemIds.has(pet.currentBackground) &&
    itemById.get(pet.currentBackground)?.type === 'background'
      ? pet.currentBackground
      : 'default'

  return normalizePet({
    ...pet,
    currentHat: normalizeWearableId(pet.currentHat, 'hat'),
    currentScarf: normalizeWearableId(pet.currentScarf, 'scarf'),
    currentShoes: normalizeWearableId(pet.currentShoes, 'shoes'),
    currentBackground,
  })
}

const normalizeTasksData = (tasks: Task[]) => {
  const legacyDefaultTaskIds = new Set([
    'read-book',
    'bag-clean',
    'brush-teeth',
    'say-thanks',
    'draw-art',
  ])
  const placeholderTaskTitles = new Set(['测试'])
  const currentById = new Map(tasks.map((task) => [task.id, task]))
  const normalizedDefaults = defaultTasks.map((defaultTask) => {
    const currentTask = currentById.get(defaultTask.id)

    if (!currentTask) {
      return defaultTask
    }

    return {
      ...defaultTask,
      status: currentTask.status,
    }
  })

  const knownIds = new Set(defaultTasks.map((task) => task.id))
  const knownTitles = new Set(defaultTasks.map((task) => task.title.trim()))
  const customTasks = tasks.filter(
    (task) => {
      if (isCustomTask(task.id)) {
        return !placeholderTaskTitles.has(task.title.trim())
      }

      return (
        !knownIds.has(task.id) &&
        !legacyDefaultTaskIds.has(task.id) &&
        !knownTitles.has(task.title.trim()) &&
        !placeholderTaskTitles.has(task.title.trim())
      )
    },
  )

  return [...normalizedDefaults, ...customTasks]
}

const normalizeMeta = (meta: AppMeta): AppMeta => {
  const defaults = createDefaultMeta()

  return {
    ...defaults,
    ...meta,
    userName: typeof meta.userName === 'string' ? meta.userName : defaults.userName,
    profileAvatar: meta.profileAvatar ?? '',
    profileAvatarUpdatedAt: getProfileAvatarUpdatedAt(meta),
    passwordHash: typeof meta.passwordHash === 'string' ? meta.passwordHash : '',
    passwordSalt: typeof meta.passwordSalt === 'string' ? meta.passwordSalt : '',
    setupCompletedAt: typeof meta.setupCompletedAt === 'string' ? meta.setupCompletedAt : '',
    sleepEndAt: typeof meta.sleepEndAt === 'number' ? meta.sleepEndAt : 0,
    sleepStartedAt: typeof meta.sleepStartedAt === 'number' ? meta.sleepStartedAt : 0,
    sleepClickCount: normalizeSleepClickCount(meta.sleepClickCount),
    sleepRecoveredEnergy: normalizeSleepRecoveredEnergy(meta.sleepRecoveredEnergy),
    lastHungerDecayAt:
      typeof meta.lastHungerDecayAt === 'number'
        ? meta.lastHungerDecayAt
        : defaults.lastHungerDecayAt,
    lastCleanDecayAt:
      typeof meta.lastCleanDecayAt === 'number' ? meta.lastCleanDecayAt : defaults.lastCleanDecayAt,
    lastEnergyDecayAt:
      typeof meta.lastEnergyDecayAt === 'number'
        ? meta.lastEnergyDecayAt
        : defaults.lastEnergyDecayAt,
    lastPlayAt: typeof meta.lastPlayAt === 'number' ? meta.lastPlayAt : defaults.lastPlayAt,
    lastPlayPenaltyStage:
      typeof meta.lastPlayPenaltyStage === 'number'
        ? meta.lastPlayPenaltyStage
        : defaults.lastPlayPenaltyStage,
    lastLowHungerMoodDecayAt:
      typeof meta.lastLowHungerMoodDecayAt === 'number'
        ? meta.lastLowHungerMoodDecayAt
        : defaults.lastLowHungerMoodDecayAt,
    lastLowCleanMoodDecayAt:
      typeof meta.lastLowCleanMoodDecayAt === 'number'
        ? meta.lastLowCleanMoodDecayAt
        : defaults.lastLowCleanMoodDecayAt,
    petPosition: normalizePetPosition(meta.petPosition),
    feedAnimationQueue: sanitizeFeedAnimationQueue(meta.feedAnimationQueue),
    lastFeedCycleItemId: getLastFeedCycleItemId(meta.lastFeedCycleItemId),
    lastPlayCycleItemId: getLastPlayCycleItemId(meta.lastPlayCycleItemId),
  }
}

const buildDefaultStore = (): PetStoreData => ({
  pet: normalizePet(defaultPet),
  tasks: cloneData(defaultTasks),
  shopItems: cloneData(defaultShopItems),
  inventory: cloneData(defaultInventory),
  pointRecords: [],
  meta: createDefaultMeta(),
})

const toPersistedAppState = (store: PetStoreData): PersistedAppState => ({
  pet: store.pet,
  tasks: store.tasks,
  shopItems: store.shopItems,
  inventory: store.inventory,
  pointRecords: store.pointRecords,
  meta: store.meta,
})

const normalizePersistedState = (state: PersistedAppState): PetStoreData => {
  const shopItems = normalizeShopItemsData(state.shopItems)
  const inventory = normalizeInventoryData(state.inventory, shopItems)

  return {
    pet: normalizePetSelections(state.pet, inventory, shopItems),
    tasks: normalizeTasksData(state.tasks),
    shopItems,
    inventory,
    pointRecords: state.pointRecords,
    meta: normalizeMeta(state.meta),
  }
}

const mergeRemoteProfileAvatar = (
  current: PetStoreData,
  remoteState: PersistedAppState,
): PetStoreData => {
  const remoteMeta = normalizeMeta(remoteState.meta)
  const currentAvatar = current.meta.profileAvatar ?? ''
  const remoteAvatar = remoteMeta.profileAvatar ?? ''
  const currentUpdatedAt = getProfileAvatarUpdatedAt(current.meta)
  const remoteUpdatedAt = getProfileAvatarUpdatedAt(remoteMeta)
  const shouldUseRemoteAvatar =
    remoteUpdatedAt > currentUpdatedAt ||
    (remoteUpdatedAt === currentUpdatedAt && Boolean(remoteAvatar) && remoteAvatar !== currentAvatar)

  if (!shouldUseRemoteAvatar) {
    return current
  }

  return {
    ...current,
    meta: normalizeMeta({
      ...current.meta,
      profileAvatar: remoteAvatar,
      profileAvatarUpdatedAt: remoteUpdatedAt,
    }),
  }
}

const saveRemoteStoreWithAvatarMerge = async (store: PetStoreData) => {
  let storeToSave = store

  try {
    const remoteState = await loadRemoteAppState()

    if (remoteState) {
      storeToSave = mergeRemoteProfileAvatar(storeToSave, remoteState)
    }
  } catch {
    // Saving the current snapshot is still better than dropping the update.
  }

  await saveRemoteAppState(toPersistedAppState(storeToSave))
}

const getInitialStoreUrlOptions = () => {
  if (typeof window === 'undefined') {
    return {
      shouldResetAllData: false,
      shouldZeroStatusForTest: false,
    }
  }

  const searchParams = new URL(window.location.href).searchParams

  return {
    shouldResetAllData:
      searchParams.get('reset') === '1' || searchParams.get('reset-data') === '1',
    shouldZeroStatusForTest: searchParams.get('test-zero-status') === '1',
  }
}

const clearInitialStoreUrlOptions = () => {
  if (typeof window === 'undefined') {
    return
  }

  const nextUrl = new URL(window.location.href)
  nextUrl.searchParams.delete('reset')
  nextUrl.searchParams.delete('reset-data')
  nextUrl.searchParams.delete('test-zero-status')
  window.history.replaceState({}, '', nextUrl.toString())
}

const createInitialStore = (): PetStoreData => {
  const { shouldResetAllData, shouldZeroStatusForTest } = getInitialStoreUrlOptions()
  const defaultSnapshot = toPersistedAppState(buildDefaultStore())

  if (shouldResetAllData) {
    clearLocalAppState()
    shouldOverwriteRemoteOnNextHydration = true
  }

  const initialSnapshot = shouldResetAllData ? defaultSnapshot : loadLocalAppState(defaultSnapshot)
  const normalizedInitialState = normalizePersistedState(initialSnapshot)
  const pet = shouldZeroStatusForTest
    ? normalizePet({
        ...normalizedInitialState.pet,
        hunger: 0,
        mood: 0,
        clean: 0,
        energy: 0,
      })
    : normalizedInitialState.pet

  if (shouldResetAllData || shouldZeroStatusForTest) {
    clearInitialStoreUrlOptions()
  }

  return autoClaimPendingTaskRewards({
    pet,
    tasks: normalizedInitialState.tasks,
    shopItems: normalizedInitialState.shopItems,
    inventory: normalizedInitialState.inventory,
    pointRecords: normalizedInitialState.pointRecords,
    meta: normalizedInitialState.meta,
  })
}

const createTaskStats = (tasks: Task[]): TaskStats => ({
  total: tasks.length,
  done: tasks.filter((task) => task.status !== 'todo').length,
  claimed: tasks.filter((task) => task.status === 'claimed').length,
  pendingClaim: tasks.filter((task) => task.status === 'done').length,
})

const getDecayIntervals = (lastAt: number, now: number, stepMs: number) =>
  Math.max(0, Math.floor((now - lastAt) / stepMs))

const getThresholdCrossedAt = (
  startValue: number,
  nextValue: number,
  threshold: number,
  decayValue: number,
  decayStepMs: number,
  lastDecayAt: number,
) => {
  if (startValue < threshold || nextValue >= threshold) {
    return lastDecayAt
  }

  const stepsToCross = Math.floor((startValue - threshold) / decayValue) + 1
  return lastDecayAt + stepsToCross * decayStepMs
}

const applyConsumableEffectInStore = (
  current: PetStoreData,
  item: ShopItem,
  now = Date.now(),
) => {
  const currentQuantity = current.inventory.consumables[item.id] ?? 0

  if (currentQuantity <= 0) {
    return current
  }

  const effect = item.effect ?? {}
  const nextPet = normalizePet({
    ...current.pet,
    hunger: current.pet.hunger + (effect.hunger ?? 0),
    mood: current.pet.mood + (effect.mood ?? 0),
    clean: current.pet.clean + (effect.clean ?? 0),
    energy: current.pet.energy + (effect.energy ?? 0),
  })
  const statChanges = getPetStatChanges(current.pet, nextPet)
  const operationId = createOperationId()
  const queuedFeedAnimations = sanitizeFeedAnimationQueue(current.meta.feedAnimationQueue)
  const queuedAnimationId = isQueuedConsumableAnimationId(item.id) ? item.id : undefined
  const shouldQueueConsumableAnimation =
    (item.type === 'food' || item.type === 'care' || item.type === 'toy') && queuedAnimationId

  return {
    ...current,
    inventory: {
      ...current.inventory,
      consumables: {
        ...current.inventory.consumables,
        [item.id]: currentQuantity - 1,
      },
    },
    pet: nextPet,
    meta: normalizeMeta({
      ...current.meta,
      lastHungerDecayAt: item.type === 'food' ? now : current.meta.lastHungerDecayAt,
      lastCleanDecayAt: item.type === 'care' ? now : current.meta.lastCleanDecayAt,
      lastPlayAt: item.type === 'toy' ? now : current.meta.lastPlayAt,
      lastPlayPenaltyStage: item.type === 'toy' ? 0 : current.meta.lastPlayPenaltyStage,
      lastLowHungerMoodDecayAt:
        item.type === 'food' && nextPet.hunger >= NEED_MOOD_DECAY_THRESHOLD
          ? now
          : current.meta.lastLowHungerMoodDecayAt,
      lastLowCleanMoodDecayAt:
        item.type === 'care' && nextPet.clean >= NEED_MOOD_DECAY_THRESHOLD
          ? now
          : current.meta.lastLowCleanMoodDecayAt,
      ...(shouldQueueConsumableAnimation
        ? {
            feedAnimationQueue: [...queuedFeedAnimations, queuedAnimationId],
            ...(item.type === 'food'
              ? { lastFeedCycleItemId: item.id as FeedCycleAnimationId }
              : {}),
            ...(item.type === 'toy'
              ? { lastPlayCycleItemId: item.id as PlayCycleAnimationId }
              : {}),
          }
        : {}),
    }),
    pointRecords: [
      createPointRecord(`使用 ${item.name}`, 0, {
        detail: hasPetStatChanges(statChanges) ? undefined : '状态已经接近满满的啦',
        operationId,
        statChanges,
        undo:
          item.type === 'food' || item.type === 'toy' || item.type === 'care'
            ? {
                type: 'consume-item',
                operationId,
                itemId: item.id,
                itemName: item.name,
                itemType: item.type,
                statDeltas: statChanges,
              }
            : undefined,
      }),
      ...current.pointRecords,
    ].slice(0, 24),
  }
}

const applyPassiveDecayInStore = (current: PetStoreData, now = Date.now()) => {
  const baseMeta = normalizeMeta(current.meta)
  let nextMeta = baseMeta
  let nextPet = current.pet
  let changed = false

  const hungerDecayCount = getDecayIntervals(baseMeta.lastHungerDecayAt ?? now, now, HUNGER_DECAY_MS)
  if (hungerDecayCount > 0) {
    const hungerBefore = nextPet.hunger
    const hungerAfter = hungerBefore - hungerDecayCount * HUNGER_DECAY_VALUE
    const hungerCrossedAt = getThresholdCrossedAt(
      hungerBefore,
      hungerAfter,
      NEED_MOOD_DECAY_THRESHOLD,
      HUNGER_DECAY_VALUE,
      HUNGER_DECAY_MS,
      baseMeta.lastHungerDecayAt ?? now,
    )

    nextPet = {
      ...nextPet,
      hunger: hungerAfter,
    }
    nextMeta = {
      ...nextMeta,
      lastHungerDecayAt: (baseMeta.lastHungerDecayAt ?? now) + hungerDecayCount * HUNGER_DECAY_MS,
      lastLowHungerMoodDecayAt:
        hungerBefore >= NEED_MOOD_DECAY_THRESHOLD && hungerAfter < NEED_MOOD_DECAY_THRESHOLD
          ? hungerCrossedAt
          : hungerAfter >= NEED_MOOD_DECAY_THRESHOLD
            ? now
            : nextMeta.lastLowHungerMoodDecayAt,
    }
    changed = true
  } else if (
    nextPet.hunger >= NEED_MOOD_DECAY_THRESHOLD &&
    nextMeta.lastLowHungerMoodDecayAt !== now
  ) {
    nextMeta = {
      ...nextMeta,
      lastLowHungerMoodDecayAt: now,
    }
  }

  const cleanDecayCount = getDecayIntervals(baseMeta.lastCleanDecayAt ?? now, now, CLEAN_DECAY_MS)
  if (cleanDecayCount > 0) {
    const cleanBefore = nextPet.clean
    const cleanAfter = cleanBefore - cleanDecayCount * CLEAN_DECAY_VALUE
    const cleanCrossedAt = getThresholdCrossedAt(
      cleanBefore,
      cleanAfter,
      NEED_MOOD_DECAY_THRESHOLD,
      CLEAN_DECAY_VALUE,
      CLEAN_DECAY_MS,
      baseMeta.lastCleanDecayAt ?? now,
    )

    nextPet = {
      ...nextPet,
      clean: cleanAfter,
    }
    nextMeta = {
      ...nextMeta,
      lastCleanDecayAt: (baseMeta.lastCleanDecayAt ?? now) + cleanDecayCount * CLEAN_DECAY_MS,
      lastLowCleanMoodDecayAt:
        cleanBefore >= NEED_MOOD_DECAY_THRESHOLD && cleanAfter < NEED_MOOD_DECAY_THRESHOLD
          ? cleanCrossedAt
          : cleanAfter >= NEED_MOOD_DECAY_THRESHOLD
            ? now
            : nextMeta.lastLowCleanMoodDecayAt,
    }
    changed = true
  } else if (
    nextPet.clean >= NEED_MOOD_DECAY_THRESHOLD &&
    nextMeta.lastLowCleanMoodDecayAt !== now
  ) {
    nextMeta = {
      ...nextMeta,
      lastLowCleanMoodDecayAt: now,
    }
  }

  const energyDecayCount = getDecayIntervals(baseMeta.lastEnergyDecayAt ?? now, now, ENERGY_DECAY_MS)
  if (energyDecayCount > 0) {
    nextPet = {
      ...nextPet,
      energy: nextPet.energy - energyDecayCount * ENERGY_DECAY_VALUE,
    }
    nextMeta = {
      ...nextMeta,
      lastEnergyDecayAt: (baseMeta.lastEnergyDecayAt ?? now) + energyDecayCount * ENERGY_DECAY_MS,
    }
    changed = true
  }

  if (nextPet.hunger < NEED_MOOD_DECAY_THRESHOLD) {
    const lowHungerMoodDecayCount = getDecayIntervals(
      nextMeta.lastLowHungerMoodDecayAt ?? now,
      now,
      LOW_NEED_MOOD_DECAY_MS,
    )

    if (lowHungerMoodDecayCount > 0) {
      nextPet = {
        ...nextPet,
        mood: nextPet.mood - lowHungerMoodDecayCount * LOW_NEED_MOOD_DECAY_VALUE,
      }
      nextMeta = {
        ...nextMeta,
        lastLowHungerMoodDecayAt:
          (nextMeta.lastLowHungerMoodDecayAt ?? now) +
          lowHungerMoodDecayCount * LOW_NEED_MOOD_DECAY_MS,
      }
      changed = true
    }
  }

  if (nextPet.clean < NEED_MOOD_DECAY_THRESHOLD) {
    const lowCleanMoodDecayCount = getDecayIntervals(
      nextMeta.lastLowCleanMoodDecayAt ?? now,
      now,
      LOW_NEED_MOOD_DECAY_MS,
    )

    if (lowCleanMoodDecayCount > 0) {
      nextPet = {
        ...nextPet,
        mood: nextPet.mood - lowCleanMoodDecayCount * LOW_NEED_MOOD_DECAY_VALUE,
      }
      nextMeta = {
        ...nextMeta,
        lastLowCleanMoodDecayAt:
          (nextMeta.lastLowCleanMoodDecayAt ?? now) +
          lowCleanMoodDecayCount * LOW_NEED_MOOD_DECAY_MS,
      }
      changed = true
    }
  }

  const noPlayElapsed = now - (baseMeta.lastPlayAt ?? now)
  const targetPlayPenaltyStage =
    noPlayElapsed >= PLAY_MOOD_STAGE_TWO_MS
      ? 2
      : noPlayElapsed >= PLAY_MOOD_STAGE_ONE_MS
        ? 1
        : 0

  if ((baseMeta.lastPlayPenaltyStage ?? 0) < targetPlayPenaltyStage) {
    let playPenalty = 0

    if ((baseMeta.lastPlayPenaltyStage ?? 0) < 1 && targetPlayPenaltyStage >= 1) {
      playPenalty += PLAY_MOOD_STAGE_ONE_VALUE
    }

    if ((baseMeta.lastPlayPenaltyStage ?? 0) < 2 && targetPlayPenaltyStage >= 2) {
      playPenalty += PLAY_MOOD_STAGE_TWO_VALUE
    }

    nextPet = {
      ...nextPet,
      mood: nextPet.mood - playPenalty,
    }
    nextMeta = {
      ...nextMeta,
      lastPlayPenaltyStage: targetPlayPenaltyStage,
    }
    changed = true
  }

  if (!changed) {
    return current
  }

  return {
    ...current,
    pet: normalizePet(nextPet),
    meta: normalizeMeta(nextMeta),
  }
}

const applyGrowthRewards = (pet: Pet, growthDelta: number) => {
  const previousLevel = pet.level
  const leveledPet = normalizePet({
    ...pet,
    growthValue: pet.growthValue + growthDelta,
  })
  const gainedLevels = leveledPet.level - previousLevel

  if (gainedLevels <= 0) {
    return {
      pet: leveledPet,
      bonusPoints: 0,
      bonusMood: 0,
      gainedLevels: 0,
    }
  }

  const bonusPoints = gainedLevels * 20
  const bonusMood = gainedLevels * 10

  return {
    pet: normalizePet({
      ...leveledPet,
      points: leveledPet.points + bonusPoints,
      mood: leveledPet.mood + bonusMood,
    }),
    bonusPoints,
    bonusMood,
    gainedLevels,
  }
}

const claimTaskRewardInStore = (
  current: PetStoreData,
  taskId: string,
  previousTaskStatus: Task['status'] = 'done',
) => {
  const activeTask = current.tasks.find((item) => item.id === taskId)

  if (!activeTask || activeTask.status !== 'done') {
    return current
  }

  const operationId = createOperationId()
  const rewardedPet = normalizePet({
    ...current.pet,
    points: current.pet.points + activeTask.points,
    mood: current.pet.mood + 5,
  })
  const growthResult = applyGrowthRewards(rewardedPet, activeTask.growth)
  const undo = {
    type: 'task-reward' as const,
    operationId,
    taskId,
    taskSnapshot: {
      ...activeTask,
      status: previousTaskStatus,
    },
    pointsDelta: activeTask.points + growthResult.bonusPoints,
    growthDelta: activeTask.growth,
    moodDelta: 5 + growthResult.bonusMood,
  }
  const rewardRecords = [
    createPointRecord(`${activeTask.title} 领取奖励`, activeTask.points, {
      growthChange: activeTask.growth,
      operationId,
      undo,
    }),
    ...(growthResult.bonusPoints > 0
      ? [
          createPointRecord(`升级奖励 Lv.${growthResult.pet.level}`, growthResult.bonusPoints, {
            operationId,
            undo,
          }),
        ]
      : []),
  ]

  return {
    ...current,
    pet: growthResult.pet,
    tasks: current.tasks.map((item) =>
      item.id === taskId ? { ...item, status: 'claimed' as const } : item,
    ),
    pointRecords: [
      ...rewardRecords,
      ...current.pointRecords,
    ].slice(0, 24),
  }
}

const completeTaskAndClaimRewardInStore = (current: PetStoreData, taskId: string) => {
  const activeTask = current.tasks.find((item) => item.id === taskId)

  if (!activeTask || activeTask.status !== 'todo') {
    return current
  }

  return claimTaskRewardInStore(
    {
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === taskId ? { ...item, status: 'done' as const } : item,
      ),
    },
    taskId,
    'todo',
  )
}

const autoClaimPendingTaskRewards = (current: PetStoreData) =>
  current.tasks.reduce(
    (nextStore, task) =>
      task.status === 'done' ? claimTaskRewardInStore(nextStore, task.id) : nextStore,
    current,
  )

const addSleepRecoveredEnergyToRecords = (
  records: PointRecord[],
  sleepStartedAt: number,
  recoveredEnergy: number,
) => {
  if (recoveredEnergy <= 0) {
    return records
  }

  let remainingEnergy = recoveredEnergy

  return records
    .slice()
    .reverse()
    .map((record) => {
      if (
        remainingEnergy <= 0 ||
        record.undo?.type !== 'sleep' ||
        record.undo.sleepStartedAt !== sleepStartedAt
      ) {
        return record
      }

      const currentRecoveredEnergy = normalizeSleepRecoveredEnergy(record.undo.recoveredEnergy)
      const capacity = Math.max(0, record.undo.recoverableEnergy - currentRecoveredEnergy)
      const appliedEnergy = Math.min(capacity, remainingEnergy)

      if (appliedEnergy <= 0) {
        return record
      }

      remainingEnergy -= appliedEnergy

      return {
        ...record,
        statChanges: {
          ...record.statChanges,
          energy: (record.statChanges?.energy ?? 0) + appliedEnergy,
        },
        detail: undefined,
        undo: {
          ...record.undo,
          recoveredEnergy: currentRecoveredEnergy + appliedEnergy,
        },
      }
    })
    .reverse()
}

const settleSleepRecoveryInStore = (current: PetStoreData, now = Date.now()) => {
  const sleepEndAt = current.meta.sleepEndAt ?? 0

  if (!sleepEndAt) {
    return {
      nextStore: current,
      didFinishSleep: false,
      recoveredEnergy: 0,
    }
  }

  const sleepClickCount = Math.max(1, normalizeSleepClickCount(current.meta.sleepClickCount))
  const sleepStartedAt =
    typeof current.meta.sleepStartedAt === 'number' && current.meta.sleepStartedAt > 0
      ? current.meta.sleepStartedAt
      : sleepEndAt - sleepClickCount * SLEEP_DURATION_MS
  const totalRecoverableEnergy = sleepClickCount * SLEEP_ENERGY_RECOVERY_VALUE
  const currentRecoveredEnergy = Math.min(
    totalRecoverableEnergy,
    normalizeSleepRecoveredEnergy(current.meta.sleepRecoveredEnergy),
  )
  const elapsedMs = Math.max(0, Math.min(now, sleepEndAt) - sleepStartedAt)
  const elapsedRecoveredEnergy = Math.min(
    totalRecoverableEnergy,
    Math.floor(elapsedMs / SLEEP_ENERGY_RECOVERY_TICK_MS),
  )
  const nextRecoveredEnergy = Math.max(currentRecoveredEnergy, elapsedRecoveredEnergy)
  const recoveredEnergy = nextRecoveredEnergy - currentRecoveredEnergy
  const didFinishSleep = sleepEndAt <= now

  if (
    recoveredEnergy <= 0 &&
    !didFinishSleep &&
    current.meta.sleepStartedAt === sleepStartedAt &&
    current.meta.sleepRecoveredEnergy === nextRecoveredEnergy
  ) {
    return {
      nextStore: current,
      didFinishSleep: false,
      recoveredEnergy: 0,
    }
  }

  const nextPet =
    recoveredEnergy > 0
      ? normalizePet({
          ...current.pet,
          energy: current.pet.energy + recoveredEnergy,
        })
      : current.pet
  const actualRecoveredEnergy = nextPet.energy - current.pet.energy

  return {
    nextStore: {
      ...current,
      pet: nextPet,
      pointRecords: addSleepRecoveredEnergyToRecords(
        current.pointRecords,
        sleepStartedAt,
        actualRecoveredEnergy,
      ),
      meta: normalizeMeta({
        ...current.meta,
        sleepEndAt: didFinishSleep ? 0 : sleepEndAt,
        sleepStartedAt: didFinishSleep ? 0 : sleepStartedAt,
        sleepClickCount: didFinishSleep ? 0 : sleepClickCount,
        sleepRecoveredEnergy: didFinishSleep ? 0 : nextRecoveredEnergy,
        lastEnergyDecayAt: didFinishSleep ? now : current.meta.lastEnergyDecayAt,
      }),
    },
    didFinishSleep,
    recoveredEnergy: actualRecoveredEnergy,
  }
}

type UndoPointRecordResult = {
  nextStore: PetStoreData
  didUndo: boolean
  message: string
}

const getPointRecordOperationId = (record: PointRecord) =>
  record.operationId ?? record.undo?.operationId ?? record.id

const removePointRecordOperation = (records: PointRecord[], record: PointRecord) => {
  const operationId = getPointRecordOperationId(record)

  return records.filter((item) => getPointRecordOperationId(item) !== operationId)
}

const applyInverseStatDeltas = (pet: Pet, statDeltas: PetStatChanges = {}) =>
  normalizePet({
    ...pet,
    hunger: pet.hunger - (statDeltas.hunger ?? 0),
    mood: pet.mood - (statDeltas.mood ?? 0),
    clean: pet.clean - (statDeltas.clean ?? 0),
    energy: pet.energy - (statDeltas.energy ?? 0),
  })

const undoPointRecordInStore = (
  current: PetStoreData,
  recordId: string,
  now = Date.now(),
): UndoPointRecordResult => {
  let workingStore = current
  let record = workingStore.pointRecords.find((item) => item.id === recordId)

  if (!record) {
    return {
      nextStore: current,
      didUndo: false,
      message: '这条记录已经不在啦。',
    }
  }

  if (!record.undo) {
    return {
      nextStore: current,
      didUndo: false,
      message: '这条旧记录没有可撤销的信息哦。',
    }
  }

  if (record.undo.type === 'sleep') {
    const settledSleep = settleSleepRecoveryInStore(workingStore, now)
    workingStore = settledSleep.nextStore
    record = workingStore.pointRecords.find((item) => item.id === recordId)

    if (!record?.undo || record.undo.type !== 'sleep') {
      return {
        nextStore: workingStore,
        didUndo: false,
        message: '这条睡觉记录已经变化啦。',
      }
    }
  }

  const { undo } = record

  if (undo.type === 'task-reward') {
    const hasTask = workingStore.tasks.some((task) => task.id === undo.taskId)
    const nextTasks = hasTask
      ? workingStore.tasks.map((task) =>
          task.id === undo.taskId ? { ...task, status: undo.taskSnapshot.status } : task,
        )
      : [undo.taskSnapshot, ...workingStore.tasks]

    return {
      nextStore: {
        ...workingStore,
        pet: normalizePet({
          ...workingStore.pet,
          points: workingStore.pet.points - undo.pointsDelta,
          growthValue: workingStore.pet.growthValue - undo.growthDelta,
          mood: workingStore.pet.mood - undo.moodDelta,
        }),
        tasks: nextTasks,
        pointRecords: removePointRecordOperation(workingStore.pointRecords, record),
      },
      didUndo: true,
      message: '奖励已经撤销啦，积分和成长值已扣回。',
    }
  }

  if (undo.type === 'purchase-item') {
    const item = workingStore.shopItems.find((shopItem) => shopItem.id === undo.itemId)

    if (!item) {
      return {
        nextStore: workingStore,
        didUndo: false,
        message: '这个礼物已经不在商店里啦，不能撤销。',
      }
    }

    const isConsumable =
      undo.itemType === 'food' || undo.itemType === 'toy' || undo.itemType === 'care'
    const nextConsumables = { ...workingStore.inventory.consumables }
    let nextOwnedItemIds = [...workingStore.inventory.ownedItemIds]

    if (isConsumable) {
      const currentQuantity = nextConsumables[undo.itemId] ?? 0

      if (currentQuantity <= 0) {
        return {
          nextStore: workingStore,
          didUndo: false,
          message: '这个礼物已经用掉啦，先撤销对应的使用记录吧。',
        }
      }

      const nextQuantity = currentQuantity - 1

      if (nextQuantity > 0) {
        nextConsumables[undo.itemId] = nextQuantity
      } else {
        delete nextConsumables[undo.itemId]
      }

      if (undo.addedOwnedItem && nextQuantity <= 0) {
        nextOwnedItemIds = nextOwnedItemIds.filter((itemId) => itemId !== undo.itemId)
      }
    } else if (undo.addedOwnedItem) {
      nextOwnedItemIds = nextOwnedItemIds.filter((itemId) => itemId !== undo.itemId)
    }

    const stillOwned = nextOwnedItemIds.includes(undo.itemId)
    const nextShopItems = workingStore.shopItems.map((shopItem) =>
      shopItem.id === undo.itemId ? { ...shopItem, owned: stillOwned } : shopItem,
    )

    return {
      nextStore: {
        ...workingStore,
        pet: normalizePet({
          ...workingStore.pet,
          points: workingStore.pet.points - undo.pointsDelta,
          currentHat:
            !stillOwned && workingStore.pet.currentHat === undo.itemId
              ? ''
              : workingStore.pet.currentHat,
          currentScarf:
            !stillOwned && workingStore.pet.currentScarf === undo.itemId
              ? ''
              : workingStore.pet.currentScarf,
          currentShoes:
            !stillOwned && workingStore.pet.currentShoes === undo.itemId
              ? ''
              : workingStore.pet.currentShoes,
          currentBackground:
            !stillOwned && workingStore.pet.currentBackground === undo.itemId
              ? 'default'
              : workingStore.pet.currentBackground,
        }),
        inventory: {
          consumables: nextConsumables,
          ownedItemIds: nextOwnedItemIds,
        },
        shopItems: nextShopItems,
        pointRecords: removePointRecordOperation(workingStore.pointRecords, record),
      },
      didUndo: true,
      message: '兑换已经撤销啦，积分已退回。',
    }
  }

  if (undo.type === 'consume-item') {
    const item = workingStore.shopItems.find((shopItem) => shopItem.id === undo.itemId)

    if (!item || !isConsumableItemType(item.type)) {
      return {
        nextStore: workingStore,
        didUndo: false,
        message: '这个使用记录找不到对应道具啦。',
      }
    }

    return {
      nextStore: {
        ...workingStore,
        pet: applyInverseStatDeltas(workingStore.pet, undo.statDeltas),
        inventory: {
          consumables: {
            ...workingStore.inventory.consumables,
            [undo.itemId]: (workingStore.inventory.consumables[undo.itemId] ?? 0) + 1,
          },
          ownedItemIds: workingStore.inventory.ownedItemIds.includes(undo.itemId)
            ? workingStore.inventory.ownedItemIds
            : [...workingStore.inventory.ownedItemIds, undo.itemId],
        },
        pointRecords: removePointRecordOperation(workingStore.pointRecords, record),
      },
      didUndo: true,
      message: `${undo.itemName} 的使用已经撤销啦。`,
    }
  }

  const recoveredEnergy = normalizeSleepRecoveredEnergy(undo.recoveredEnergy)
  const isSameActiveSleep =
    Boolean(workingStore.meta.sleepEndAt) && workingStore.meta.sleepStartedAt === undo.sleepStartedAt
  const currentSleepClickCount = normalizeSleepClickCount(workingStore.meta.sleepClickCount)
  const nextSleepClickCount = Math.max(0, currentSleepClickCount - 1)
  const nextSleepEndAt = (workingStore.meta.sleepEndAt ?? 0) - SLEEP_DURATION_MS
  const shouldClearSleep =
    !isSameActiveSleep || nextSleepClickCount <= 0 || nextSleepEndAt <= now
  const nextSleepRecoveredEnergy = Math.min(
    normalizeSleepRecoveredEnergy(workingStore.meta.sleepRecoveredEnergy),
    nextSleepClickCount * SLEEP_ENERGY_RECOVERY_VALUE,
  )

  return {
    nextStore: {
      ...workingStore,
      pet: normalizePet({
        ...workingStore.pet,
        energy: workingStore.pet.energy - recoveredEnergy,
      }),
      meta: isSameActiveSleep
        ? normalizeMeta({
            ...workingStore.meta,
            sleepEndAt: shouldClearSleep ? 0 : nextSleepEndAt,
            sleepStartedAt: shouldClearSleep ? 0 : workingStore.meta.sleepStartedAt,
            sleepClickCount: shouldClearSleep ? 0 : nextSleepClickCount,
            sleepRecoveredEnergy: shouldClearSleep ? 0 : nextSleepRecoveredEnergy,
            lastEnergyDecayAt: shouldClearSleep ? now : workingStore.meta.lastEnergyDecayAt,
          })
        : workingStore.meta,
      pointRecords: removePointRecordOperation(workingStore.pointRecords, record),
    },
    didUndo: true,
    message:
      recoveredEnergy > 0
        ? '睡觉记录已经撤销啦，恢复过的体力也扣回了。'
        : '睡觉记录已经撤销啦。',
  }
}

const applyDailyRefresh = (current: PetStoreData) => {
  const today = getLocalDateKey()
  const messages: string[] = []
  let changed = false
  let nextPet = current.pet
  let nextTasks = current.tasks
  let nextMeta = current.meta

  if (current.meta.lastTaskRefreshDate !== today) {
    nextTasks = current.tasks.map((task) =>
      task.status === 'todo' ? task : { ...task, status: 'todo' as const },
    )
    nextMeta = { ...nextMeta, lastTaskRefreshDate: today }
    changed = true

    if (current.meta.lastTaskRefreshDate) {
      messages.push('新的一天开始啦，今日任务已经准备好啦！')
    }
  }

  if (current.meta.lastLoginRewardDate !== today) {
    const dayDifference = getDayDifference(current.meta.lastLoginRewardDate, today)
    const streakCount =
      current.meta.lastLoginRewardDate && dayDifference === 1
        ? current.meta.streakCount + 1
        : 1

    nextMeta = {
      ...nextMeta,
      lastLoginRewardDate: today,
      streakCount,
    }
    changed = true
    messages.push(
      streakCount > 1
        ? `欢迎回来！已经连续陪伴 ${streakCount} 天啦`
        : '今天也来陪小猫啦！',
    )
  }

  if (current.meta.lastActiveDate !== today) {
    nextMeta = { ...nextMeta, lastActiveDate: today }
    changed = true
  }

  if (!changed) {
    return { nextStore: current, messages }
  }

  return {
    nextStore: {
      ...current,
      pet: nextPet,
      tasks: nextTasks,
      pointRecords: current.pointRecords,
      meta: nextMeta,
    },
    messages,
  }
}

export const PetProvider = ({ children }: { children: ReactNode }) => {
  const [store, setStore] = useState<PetStoreData>(createInitialStore)
  const [hasHydratedRemoteStore, setHasHydratedRemoteStore] = useState(false)
  const [isSessionUnlocked, setIsSessionUnlocked] = useState(false)
  const [levelUpCelebration, setLevelUpCelebration] = useState<LevelUpCelebrationState | null>(
    null,
  )
  const storeRef = useRef(store)
  const shouldOverwriteRemoteOnHydrateRef = useRef(shouldOverwriteRemoteOnNextHydration)
  const remoteSaveTimerRef = useRef<number | null>(null)
  const shouldSkipNextRemoteSaveRef = useRef(false)
  const levelUpCelebrationTimerRef = useRef<number | null>(null)
  const { showToast } = useToast()

  const triggerLevelUpCelebration = (level: number) => {
    if (levelUpCelebrationTimerRef.current) {
      window.clearTimeout(levelUpCelebrationTimerRef.current)
    }

    setLevelUpCelebration({
      level,
      token: Date.now(),
    })

    levelUpCelebrationTimerRef.current = window.setTimeout(() => {
      levelUpCelebrationTimerRef.current = null
      setLevelUpCelebration(null)
    }, 10_000)
  }

  const commitStore = (updater: (current: PetStoreData) => PetStoreData) => {
    const next = updater(storeRef.current)
    storeRef.current = next
    setStore(next)
    return next
  }

  useEffect(() => {
    storeRef.current = store
    saveLocalAppState(toPersistedAppState(store))
  }, [store])

  useEffect(
    () => () => {
      if (levelUpCelebrationTimerRef.current) {
        window.clearTimeout(levelUpCelebrationTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    let isCancelled = false

    const hydrateRemoteStore = async () => {
      try {
        if (shouldOverwriteRemoteOnHydrateRef.current) {
          await saveRemoteAppState(toPersistedAppState(storeRef.current))
          return
        }

        const remoteState = await loadRemoteAppState()

        if (isCancelled) {
          return
        }

        if (remoteState) {
          const nextStore = autoClaimPendingTaskRewards(normalizePersistedState(remoteState))
          storeRef.current = nextStore
          setStore(nextStore)
        } else {
          await saveRemoteAppState(toPersistedAppState(storeRef.current))
        }
      } catch {
        // Fallback to the browser cache when the backend is not available yet.
      } finally {
        if (!isCancelled) {
          shouldOverwriteRemoteOnNextHydration = false
          shouldOverwriteRemoteOnHydrateRef.current = false
          setIsSessionUnlocked(shouldRestoreSessionUnlock(storeRef.current.meta))
          setHasHydratedRemoteStore(true)
        }
      }
    }

    void hydrateRemoteStore()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hasHydratedRemoteStore) {
      return
    }

    if (shouldSkipNextRemoteSaveRef.current) {
      shouldSkipNextRemoteSaveRef.current = false
      return
    }

    if (remoteSaveTimerRef.current) {
      window.clearTimeout(remoteSaveTimerRef.current)
    }

    remoteSaveTimerRef.current = window.setTimeout(() => {
      remoteSaveTimerRef.current = null
      void saveRemoteStoreWithAvatarMerge(storeRef.current).catch(() => {
        // Keep the local cache as the last-resort fallback if the backend save fails.
      })
    }, 220)

    return () => {
      if (remoteSaveTimerRef.current) {
        window.clearTimeout(remoteSaveTimerRef.current)
        remoteSaveTimerRef.current = null
      }
    }
  }, [hasHydratedRemoteStore, store])

  useEffect(() => {
    if (!hasHydratedRemoteStore || !isSessionUnlocked) {
      return
    }

    let isCancelled = false
    let isSyncing = false

    const syncRemoteProfileAvatar = async () => {
      if (isSyncing) {
        return
      }

      isSyncing = true

      try {
        const remoteState = await loadRemoteAppState()

        if (isCancelled || !remoteState) {
          return
        }

        const nextStore = mergeRemoteProfileAvatar(storeRef.current, remoteState)

        if (nextStore !== storeRef.current) {
          shouldSkipNextRemoteSaveRef.current = true
          commitStore(() => nextStore)
        }
      } catch {
        // The regular local cache keeps the UI usable while remote sync is unavailable.
      } finally {
        isSyncing = false
      }
    }

    void syncRemoteProfileAvatar()
    const intervalId = window.setInterval(syncRemoteProfileAvatar, REMOTE_AVATAR_SYNC_MS)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void syncRemoteProfileAvatar()
      }
    }

    window.addEventListener('focus', syncRemoteProfileAvatar)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener('focus', syncRemoteProfileAvatar)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [hasHydratedRemoteStore, isSessionUnlocked])

  useEffect(() => {
    if (!hasHydratedRemoteStore || !isSessionUnlocked) {
      return
    }

    const runDailyRefresh = () => {
      const { nextStore, messages } = applyDailyRefresh(storeRef.current)

      if (nextStore !== storeRef.current) {
        commitStore(() => nextStore)
      }

      messages.forEach((message, index) => {
        window.setTimeout(() => showToast(message), index * 260)
      })
    }

    runDailyRefresh()
    const intervalId = window.setInterval(runDailyRefresh, 60_000)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runDailyRefresh()
      }
    }

    window.addEventListener('focus', runDailyRefresh)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', runDailyRefresh)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [hasHydratedRemoteStore, isSessionUnlocked, showToast])

  useEffect(() => {
    if (!hasHydratedRemoteStore || !isSessionUnlocked) {
      return
    }

    const syncPassiveSystems = () => {
      const nextStore = applyPassiveDecayInStore(storeRef.current)

      if (nextStore !== storeRef.current) {
        commitStore(() => nextStore)
      }
    }

    syncPassiveSystems()
    const intervalId = window.setInterval(syncPassiveSystems, 60_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [hasHydratedRemoteStore, isSessionUnlocked])

  useEffect(() => {
    if (!hasHydratedRemoteStore || !isSessionUnlocked) {
      return
    }

    const trySettleSleepRecovery = () => {
      const { nextStore, didFinishSleep } = settleSleepRecoveryInStore(storeRef.current)

      if (nextStore === storeRef.current) {
        return false
      }

      commitStore(() => nextStore)

      if (didFinishSleep) {
        showToast('睡醒啦，体力已经按睡眠时间恢复好啦！')
      }

      return true
    }

    if (!store.meta.sleepEndAt) {
      return
    }

    trySettleSleepRecovery()
    const intervalId = window.setInterval(trySettleSleepRecovery, 1000)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        trySettleSleepRecovery()
      }
    }

    window.addEventListener('focus', trySettleSleepRecovery)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', trySettleSleepRecovery)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [hasHydratedRemoteStore, isSessionUnlocked, store.meta.sleepEndAt, showToast])

  const performCareAction = (action: 'feed' | 'wash' | 'play' | 'sleep') => {
    if (action === 'sleep') {
      const now = Date.now()
      let currentStore = storeRef.current
      const settledSleep = settleSleepRecoveryInStore(currentStore, now)

      if (settledSleep.nextStore !== currentStore) {
        currentStore = commitStore(() => settledSleep.nextStore)

        if (settledSleep.didFinishSleep) {
          showToast('睡醒啦，体力已经按睡眠时间恢复好啦！')
        }
      }

      const activeSleepEndAt = currentStore.meta.sleepEndAt ?? 0
      const activeSleepClickCount =
        activeSleepEndAt > now && !currentStore.meta.sleepClickCount
          ? 1
          : normalizeSleepClickCount(currentStore.meta.sleepClickCount)

      if (activeSleepEndAt > now && activeSleepClickCount >= SLEEP_MAX_CLICK_COUNT) {
        showToast('这一觉最多点 10 次啦，等小猫睡醒再继续。')
        return
      }

      const nextSleepClickCount = activeSleepEndAt > now ? activeSleepClickCount + 1 : 1
      const nextSleepEndAt =
        (activeSleepEndAt > now ? activeSleepEndAt : now) + SLEEP_DURATION_MS
      const nextSleepStartedAt =
        activeSleepEndAt > now ? currentStore.meta.sleepStartedAt || now : now
      const operationId = createOperationId()

      commitStore((current) => ({
        ...current,
        meta: normalizeMeta({
          ...current.meta,
          sleepEndAt: nextSleepEndAt,
          sleepStartedAt: nextSleepStartedAt,
          sleepClickCount: nextSleepClickCount,
          sleepRecoveredEnergy:
            activeSleepEndAt > now
              ? normalizeSleepRecoveredEnergy(current.meta.sleepRecoveredEnergy)
              : 0,
        }),
        pointRecords: [
          createPointRecord(nextSleepClickCount === 1 ? '睡觉 1 分钟' : '睡觉加时 1 分钟', 0, {
            detail: '体力慢慢恢复',
            operationId,
            undo: {
              type: 'sleep',
              operationId,
              sleepStartedAt: nextSleepStartedAt,
              recoverableEnergy: SLEEP_ENERGY_RECOVERY_VALUE,
              recoveredEnergy: 0,
            },
          }),
          ...current.pointRecords,
        ].slice(0, 24),
      }))

      showToast(
        nextSleepClickCount === 1
          ? '已经睡下啦，体力会按时间慢慢恢复！'
          : `已加 1 分钟，这一觉 ${nextSleepClickCount}/10 次，最多恢复 ${nextSleepClickCount * SLEEP_ENERGY_RECOVERY_VALUE} 点体力。`,
      )
      return
    }

    if (action === 'wash') {
      const careItem = getFirstAvailableConsumableItem(storeRef.current, 'care')

      if (careItem) {
        commitStore((current) => applyConsumableEffectInStore(current, careItem))

        showToast(`用了${careItem.name}，小猫洗香香啦！`)
        return
      }

      showToast('先去商店买点用品，再来洗香香吧！')
      return
    }

    if (action === 'feed') {
      const foodItem = getNextFeedCycleItem(storeRef.current)

      if (!foodItem) {
        showToast('先去商店买点食物，再来喂小猫吧！')
        return
      }

      commitStore((current) => applyConsumableEffectInStore(current, foodItem))

      showToast(`用了${foodItem.name}，小猫吃得香香的！`)
      return
    }

    if (action === 'play') {
      const toyItem = getNextPlayCycleItem(storeRef.current)

      if (!toyItem) {
        if (getFirstAvailableConsumableItem(storeRef.current, 'toy')) {
          showToast('体力不够啦，先睡一觉再陪它玩吧！')
          return
        }

        showToast('先去商店买点玩具，再来陪它玩吧！')
        return
      }

      commitStore((current) => applyConsumableEffectInStore(current, toyItem))

      showToast(`用了${toyItem.name}，小猫玩得可开心啦！`)
      return
    }
  }

  const markTaskDone = (taskId: string) => {
    const task = storeRef.current.tasks.find((item) => item.id === taskId)

    if (!task) {
      return
    }

    if (task.status === 'done') {
      showToast('这个任务的奖励已经准备好啦。')
      return
    }

    if (task.status === 'claimed') {
      showToast('这个任务的奖励已经拿到啦！')
      return
    }

    const previousLevel = storeRef.current.pet.level
    const nextStore = commitStore((current) => completeTaskAndClaimRewardInStore(current, taskId))

    showToast(`太棒啦！自动收到 ${task.points} 积分和 ${task.growth} 成长值`)

    if (nextStore.pet.level > previousLevel) {
      showToast(`升级啦！现在是 Lv.${nextStore.pet.level}`)
      triggerLevelUpCelebration(nextStore.pet.level)
    }
  }

  const claimTaskReward = (taskId: string) => {
    const task = storeRef.current.tasks.find((item) => item.id === taskId)

    if (!task) {
      return
    }

    if (task.status === 'todo') {
      showToast('先点一下“我完成啦”，再来领取奖励吧。')
      return
    }

    if (task.status === 'claimed') {
      showToast('这个奖励已经领到啦！')
      return
    }

    const previousLevel = storeRef.current.pet.level
    const nextStore = commitStore((current) => claimTaskRewardInStore(current, taskId))

    showToast(`奖励收到啦！获得 ${task.points} 积分和 ${task.growth} 成长值`)

    if (nextStore.pet.level > previousLevel) {
      showToast(`升级啦！现在是 Lv.${nextStore.pet.level}`)
      triggerLevelUpCelebration(nextStore.pet.level)
    }
  }

  const addCustomTask = (task: NewTaskInput) => {
    const title = task.title.trim()
    const points = normalizeRewardValue(task.points, 10)
    const growth = normalizeRewardValue(task.growth, 5)

    if (!title) {
      showToast('先给新任务起个名字吧。')
      return
    }

    commitStore((current) => ({
      ...current,
      tasks: [
        {
          id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          title,
          icon: task.icon?.trim() || '✨',
          points,
          growth,
          status: 'todo',
        },
        ...current.tasks,
      ],
    }))

    showToast(`新任务“${title}”已经加进今日任务啦！`)
  }

  const updateCustomTask = (taskId: string, task: NewTaskInput) => {
    if (!isCustomTask(taskId)) {
      return
    }

    const title = task.title.trim()
    const points = normalizeRewardValue(task.points, 10)
    const growth = normalizeRewardValue(task.growth, 5)

    if (!title) {
      showToast('任务名称不能为空哦。')
      return
    }

    commitStore((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === taskId
          ? {
              ...item,
              title,
              icon: task.icon?.trim() || '✨',
              points,
              growth,
            }
          : item,
      ),
    }))

    showToast(`任务“${title}”已经更新啦！`)
  }

  const deleteCustomTask = (taskId: string) => {
    if (!isCustomTask(taskId)) {
      return
    }

    const task = storeRef.current.tasks.find((item) => item.id === taskId)

    commitStore((current) => ({
      ...current,
      tasks: current.tasks.filter((item) => item.id !== taskId),
    }))

    showToast(task ? `任务“${task.title}”已经删除啦。` : '任务已经删除啦。')
  }

  const resetCustomTaskStatus = (taskId: string) => {
    if (!isCustomTask(taskId)) {
      return
    }

    const task = storeRef.current.tasks.find((item) => item.id === taskId)

    if (!task || task.status === 'todo') {
      return
    }

    commitStore((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === taskId ? { ...item, status: 'todo' as const } : item,
      ),
    }))

    showToast(`任务“${task.title}”可以重新做啦！`)
  }

  const undoPointRecord = (recordId: string) => {
    let result: UndoPointRecordResult = {
      nextStore: storeRef.current,
      didUndo: false,
      message: '这条记录暂时不能撤销哦。',
    }

    commitStore((current) => {
      result = undoPointRecordInStore(current, recordId)
      return result.nextStore
    })

    showToast(result.message)
  }

  const purchaseItem = (itemId: string) => {
    const item = storeRef.current.shopItems.find((shopItem) => shopItem.id === itemId)

    if (!item) {
      return
    }

    if (storeRef.current.pet.points < item.price) {
      showToast('积分不够哦，再完成几个任务吧！')
      return
    }

    if (
      !isConsumableItemType(item.type) &&
      storeRef.current.inventory.ownedItemIds.includes(item.id)
    ) {
      showToast('这个礼物已经在背包里啦！')
      return
    }

    commitStore((current) => {
      const operationId = createOperationId()
      const nextInventory = {
        ...current.inventory,
        consumables: { ...current.inventory.consumables },
        ownedItemIds: [...current.inventory.ownedItemIds],
      }
      const addedOwnedItem = !nextInventory.ownedItemIds.includes(item.id)

      if (isConsumableItemType(item.type)) {
        nextInventory.consumables[item.id] = (nextInventory.consumables[item.id] ?? 0) + 1
      }

      if (addedOwnedItem) {
        nextInventory.ownedItemIds.push(item.id)
      }

      return {
        ...current,
        pet: normalizePet({ ...current.pet, points: current.pet.points - item.price }),
        inventory: nextInventory,
        shopItems:
          isConsumableItemType(item.type)
            ? current.shopItems
            : current.shopItems.map((shopItem) =>
                shopItem.id === item.id ? { ...shopItem, owned: true } : shopItem,
              ),
        pointRecords: [
          createPointRecord(`兑换 ${item.name}`, -item.price, {
            operationId,
            undo: {
              type: 'purchase-item',
              operationId,
              itemId: item.id,
              itemName: item.name,
              itemType: item.type,
              pointsDelta: -item.price,
              addedOwnedItem,
            },
          }),
          ...current.pointRecords,
        ].slice(0, 24),
      }
    })

    showToast(
      isConsumableItemType(item.type)
        ? `${item.name} 已经放进背包啦！`
        : `${item.name} 兑换成功，快去背包看看吧！`,
    )
  }

  const applyInventoryItem = (itemId: string) => {
    const item = storeRef.current.shopItems.find((shopItem) => shopItem.id === itemId)

    if (!item) {
      return
    }

    if (isConsumableItemType(item.type)) {
      const quantity = storeRef.current.inventory.consumables[item.id] ?? 0

      if (quantity <= 0) {
        showToast('背包里还没有这个道具哦。')
        return
      }

      if (!canUseConsumableItem(storeRef.current.pet, item)) {
        showToast('体力不够啦，先睡一觉再来玩吧！')
        return
      }

      commitStore((current) => applyConsumableEffectInStore(current, item))

      const consumableToastMap = {
        food: '小猫吃得香香的！',
        toy: '小猫玩得咕噜咕噜转圈圈！',
        care: `用了${item.name}，小猫变得干干净净啦！`,
      } as const

      showToast(consumableToastMap[item.type])
      return
    }

    if (!storeRef.current.inventory.ownedItemIds.includes(item.id)) {
      showToast('先去商店把这个礼物带回家吧！')
      return
    }

    commitStore((current) => {
      if (item.type === 'background') {
        return {
          ...current,
          pet: normalizePet({
            ...current.pet,
            currentBackground: current.pet.currentBackground === item.id ? 'default' : item.id,
          }),
        }
      }

      if (item.type === 'clothing' && item.wearableSlot === 'hat') {
        return {
          ...current,
          pet: normalizePet({
            ...current.pet,
            currentHat: current.pet.currentHat === item.id ? '' : item.id,
          }),
        }
      }

      if (item.type === 'clothing' && item.wearableSlot === 'scarf') {
        return {
          ...current,
          pet: normalizePet({
            ...current.pet,
            currentScarf: current.pet.currentScarf === item.id ? '' : item.id,
          }),
        }
      }

      if (item.type === 'clothing' && item.wearableSlot === 'shoes') {
        return {
          ...current,
          pet: normalizePet({
            ...current.pet,
            currentShoes: current.pet.currentShoes === item.id ? '' : item.id,
          }),
        }
      }

      return current
    })

    const isRemovingBackground = item.type === 'background' && storeRef.current.pet.currentBackground === 'default'
    const isRemovingHat = item.wearableSlot === 'hat' && storeRef.current.pet.currentHat === ''
    const isRemovingScarf = item.wearableSlot === 'scarf' && storeRef.current.pet.currentScarf === ''
    const isRemovingShoes = item.wearableSlot === 'shoes' && storeRef.current.pet.currentShoes === ''
    const isRemovingClothing = isRemovingHat || isRemovingScarf || isRemovingShoes

    showToast(
      item.type === 'background'
        ? isRemovingBackground
          ? '已经恢复成默认房间啦！'
          : `${item.name} 已经布置好啦！`
        : isRemovingClothing
          ? `${item.name} 已经脱下来啦！`
          : `${item.name} 穿上之后更可爱啦！`,
    )
  }

  const consumeNextFeedAnimation = () => {
    commitStore((current) => {
      const feedAnimationQueue = sanitizeFeedAnimationQueue(current.meta.feedAnimationQueue)

      if (!feedAnimationQueue.length) {
        return current
      }

      return {
        ...current,
        meta: normalizeMeta({
          ...current.meta,
          feedAnimationQueue: feedAnimationQueue.slice(1),
        }),
      }
    })
  }

  const resetAllData = () => {
    clearLocalAppState()
    const next = buildDefaultStore()
    storeRef.current = next
    setStore(next)
    setIsSessionUnlocked(false)
    if (hasHydratedRemoteStore) {
      void saveRemoteAppState(toPersistedAppState(next)).catch(() => {
        // The browser cache already holds the reset state even if the backend is offline.
      })
    }
    showToast('已经回到和小猫第一次见面的那一天啦！')
  }

  const completeFirstRunSetup = ({
    passwordHash,
    passwordSalt,
    petName,
    userName,
  }: FirstRunSetupInput) => {
    commitStore((current) => ({
      ...current,
      pet: normalizePet({
        ...current.pet,
        name: petName,
      }),
      meta: normalizeMeta({
        ...current.meta,
        passwordHash,
        passwordSalt,
        setupCompletedAt: new Date().toISOString(),
        userName,
      }),
    }))
    saveSessionUnlock(passwordHash)
    setIsSessionUnlocked(true)
    showToast('小家已经准备好啦！')
  }

  const unlockSession = () => {
    saveSessionUnlock(storeRef.current.meta.passwordHash ?? '')
    setIsSessionUnlocked(true)
  }

  const setPetPosition = (position: PetPosition) => {
    commitStore((current) => ({
      ...current,
      meta: normalizeMeta({
        ...current.meta,
        petPosition: position,
      }),
    }))
  }

  const setProfileAvatar = (avatarDataUrl: string) => {
    commitStore((current) => ({
      ...current,
      meta: normalizeMeta({
        ...current.meta,
        profileAvatar: avatarDataUrl,
        profileAvatarUpdatedAt: Date.now(),
      }),
    }))

    showToast('头像已经换好啦！')
  }

  const growthProgress = getGrowthProgress(store.pet.growthValue, store.pet.level, levelRules)
  const nextLevelRule = getNextLevelRule(store.pet.level, levelRules)
  const inventoryItems = store.shopItems.filter((item) => {
    if (!store.inventory.ownedItemIds.includes(item.id)) {
      return false
    }

    if (isConsumableItemType(item.type)) {
      return (store.inventory.consumables[item.id] ?? 0) > 0
    }

    return true
  })
  const currentBackgroundItem = store.shopItems.find(
    (item) => item.id === store.pet.currentBackground,
  )
  const equippedHatItem = store.shopItems.find((item) => item.id === store.pet.currentHat)
  const equippedScarfItem = store.shopItems.find((item) => item.id === store.pet.currentScarf)
  const equippedShoesItem = store.shopItems.find((item) => item.id === store.pet.currentShoes)
  const moodMax = getMoodMax(store.pet)
  const lowStatusHints = [
    store.pet.hunger < NEED_MOOD_DECAY_THRESHOLD ? '小猫有点饿啦，喂一喂会更开心。' : '',
    store.pet.clean < NEED_MOOD_DECAY_THRESHOLD ? '小猫想洗香香，泡泡时间到啦。' : '',
    store.pet.energy < 40 ? '小猫有点累了，先轻轻陪它休息一下吧。' : '',
    store.pet.mood < 40 ? '小猫想被你陪一会儿，玩耍会让它开心起来。' : '',
  ].filter(Boolean)
  const taskStats = createTaskStats(store.tasks)
  const todayTip =
    lowStatusHints[0] ??
    (taskStats.pendingClaim > 0
      ? `今天有 ${taskStats.pendingClaim} 个奖励在等你领取。`
      : taskStats.claimed === taskStats.total
        ? '今天的任务奖励都已经收好啦，去商店看看新礼物吧！'
        : store.meta.streakCount > 1
          ? `已经连续陪伴 ${store.meta.streakCount} 天啦，小猫越来越信任你了。`
          : '先完成一个小任务，小猫会更开心哦。')

  return (
    <PetStoreContext.Provider
      value={{
        pet: store.pet,
        tasks: store.tasks,
        shopItems: store.shopItems,
        inventory: store.inventory,
        inventoryItems,
        pointRecords: store.pointRecords,
        meta: store.meta,
        moodMax,
        growthProgress,
        nextLevelRule,
        currentBackgroundItem,
        equippedHatItem,
        equippedScarfItem,
        equippedShoesItem,
        lowStatusHints,
        todayTip,
        taskStats,
        levelUpCelebration,
        isStoreReady: hasHydratedRemoteStore,
        isSessionUnlocked,
        performCareAction,
        markTaskDone,
        claimTaskReward,
        addCustomTask,
        updateCustomTask,
        deleteCustomTask,
        resetCustomTaskStatus,
        undoPointRecord,
        purchaseItem,
        applyInventoryItem,
        consumeNextFeedAnimation,
        completeFirstRunSetup,
        unlockSession,
        setPetPosition,
        setProfileAvatar,
        resetAllData,
      }}
    >
      {children}
    </PetStoreContext.Provider>
  )
}
