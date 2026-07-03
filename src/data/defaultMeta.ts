import type { AppMeta } from '../types'

export const createDefaultMeta = (): AppMeta => {
  const now = Date.now()

  return {
    lastActiveDate: '',
    lastLoginRewardDate: '',
    lastTaskRefreshDate: '',
    streakCount: 0,
    userName: '',
    profileAvatar: '',
    profileAvatarUpdatedAt: 0,
    passwordHash: '',
    passwordSalt: '',
    setupCompletedAt: '',
    sleepEndAt: 0,
    sleepStartedAt: 0,
    sleepClickCount: 0,
    sleepRecoveredEnergy: 0,
    lastHungerDecayAt: now,
    lastCleanDecayAt: now,
    lastEnergyDecayAt: now,
    lastPlayAt: now,
    lastPlayPenaltyStage: 0,
    lastLowHungerMoodDecayAt: now,
    lastLowCleanMoodDecayAt: now,
    petPosition: { x: 0.5, y: 0.78 },
    feedAnimationQueue: [],
    lastFeedCycleItemId: '',
    lastPlayCycleItemId: '',
  }
}
