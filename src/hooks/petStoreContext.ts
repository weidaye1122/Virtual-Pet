import { createContext } from 'react'
import type {
  AppMeta,
  InventoryState,
  NewTaskInput,
  Pet,
  PetPosition,
  PointRecord,
  ShopItem,
  Task,
  TaskStats,
} from '../types'
import type { getGrowthProgress, getNextLevelRule } from '../utils/level'

export type LevelUpCelebrationState = {
  level: number
  token: number
}

export type FirstRunSetupInput = {
  passwordHash: string
  passwordSalt: string
  petName: string
  userName: string
}

export type PetStoreContextValue = {
  pet: Pet
  tasks: Task[]
  shopItems: ShopItem[]
  inventory: InventoryState
  inventoryItems: ShopItem[]
  pointRecords: PointRecord[]
  meta: AppMeta
  moodMax: number
  growthProgress: ReturnType<typeof getGrowthProgress>
  nextLevelRule: ReturnType<typeof getNextLevelRule>
  currentBackgroundItem?: ShopItem
  equippedHatItem?: ShopItem
  equippedScarfItem?: ShopItem
  equippedShoesItem?: ShopItem
  lowStatusHints: string[]
  todayTip: string
  taskStats: TaskStats
  levelUpCelebration: LevelUpCelebrationState | null
  hasPassword: boolean
  isStoreReady: boolean
  isSessionUnlocked: boolean
  performCareAction: (action: 'feed' | 'wash' | 'play' | 'sleep') => void
  markTaskDone: (taskId: string) => void
  claimTaskReward: (taskId: string) => void
  addCustomTask: (task: NewTaskInput) => void
  updateCustomTask: (taskId: string, task: NewTaskInput) => void
  deleteCustomTask: (taskId: string) => void
  resetCustomTaskStatus: (taskId: string) => void
  undoPointRecord: (recordId: string) => void
  purchaseItem: (itemId: string) => void
  applyInventoryItem: (itemId: string) => void
  consumeNextFeedAnimation: () => void
  completeFirstRunSetup: (input: FirstRunSetupInput) => Promise<void>
  unlockSession: (password: string) => Promise<boolean>
  setPetPosition: (position: PetPosition) => void
  setProfileAvatar: (avatarDataUrl: string) => void
  resetAllData: () => void
}

export const PetStoreContext = createContext<PetStoreContextValue | null>(null)
