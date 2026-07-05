export type Pet = {
  name: string
  level: number
  growthValue: number
  points: number
  hunger: number
  mood: number
  clean: number
  energy: number
  stage: string
  currentHat?: string
  currentScarf?: string
  currentShoes?: string
  currentBackground?: string
}

export type PetPosition = {
  x: number
  y: number
}

export type TaskStatus = 'todo' | 'done' | 'claimed'

export type Task = {
  id: string
  title: string
  icon: string
  points: number
  growth: number
  status: TaskStatus
}

export type NewTaskInput = {
  title: string
  icon?: string
  points: number
  growth: number
}

export type FeedAnimationId =
  | 'cat-food'
  | 'canned-food'
  | 'milk'
  | 'fish-snack'
  | 'body-wash'
  | 'yarn-ball'
  | 'feather-wand'
export type FeedCycleAnimationId = Exclude<
  FeedAnimationId,
  'body-wash' | 'yarn-ball' | 'feather-wand'
>
export type PlayCycleAnimationId = 'yarn-ball' | 'feather-wand'

export type AppMeta = {
  lastActiveDate: string
  lastLoginRewardDate: string
  lastTaskRefreshDate: string
  streakCount: number
  userName: string
  profileAvatar?: string
  profileAvatarUpdatedAt?: number
  passwordHash?: string
  passwordSalt?: string
  setupCompletedAt?: string
  sleepEndAt?: number
  sleepStartedAt?: number
  sleepClickCount?: number
  sleepRecoveredEnergy?: number
  lastHungerDecayAt?: number
  lastCleanDecayAt?: number
  lastEnergyDecayAt?: number
  lastPlayAt?: number
  lastPlayPenaltyStage?: number
  lastLowHungerMoodDecayAt?: number
  lastLowCleanMoodDecayAt?: number
  petPosition: PetPosition
  feedAnimationQueue: FeedAnimationId[]
  lastFeedCycleItemId: FeedCycleAnimationId | ''
  lastPlayCycleItemId: PlayCycleAnimationId | ''
}

export type TaskStats = {
  total: number
  done: number
  claimed: number
  pendingClaim: number
}

export type ItemType = 'food' | 'toy' | 'care' | 'clothing' | 'background' | 'effect'
export type WearableSlot = 'hat' | 'scarf' | 'shoes'

export type ShopItem = {
  id: string
  name: string
  icon: string
  type: ItemType
  price: number
  owned: boolean
  description: string
  wearableSlot?: WearableSlot
  effect?: {
    hunger?: number
    mood?: number
    clean?: number
    energy?: number
  }
}

export type InventoryState = {
  consumables: Record<string, number>
  ownedItemIds: string[]
}

export type PetStatChanges = {
  hunger?: number
  mood?: number
  clean?: number
  energy?: number
}

export type PointRecordUndo =
  | {
      type: 'task-reward'
      operationId: string
      taskId: string
      taskSnapshot: Task
      pointsDelta: number
      growthDelta: number
      moodDelta: number
    }
  | {
      type: 'purchase-item'
      operationId: string
      itemId: string
      itemName: string
      itemType: ItemType
      pointsDelta: number
      addedOwnedItem: boolean
    }
  | {
      type: 'consume-item'
      operationId: string
      itemId: string
      itemName: string
      itemType: Extract<ItemType, 'food' | 'toy' | 'care'>
      statDeltas: PetStatChanges
    }
  | {
      type: 'sleep'
      operationId: string
      sleepStartedAt: number
      recoverableEnergy: number
      recoveredEnergy: number
    }

export type PointRecord = {
  id: string
  title: string
  change: number
  growthChange?: number
  statChanges?: PetStatChanges
  detail?: string
  operationId?: string
  undo?: PointRecordUndo
  createdAt: string
}

export type LevelRule = {
  level: number
  needGrowth: number
}

export type GrowthStage = {
  id: string
  name: string
  minLevel: number
  maxLevel: number
  description: string
}

export type ToastMessage = {
  id: string
  text: string
}

export type PersistedAppState = {
  pet: Pet
  tasks: Task[]
  shopItems: ShopItem[]
  inventory: InventoryState
  pointRecords: PointRecord[]
  meta: AppMeta
}
