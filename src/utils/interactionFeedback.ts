export type InteractionFeedbackKind =
  | 'button'
  | 'careAction'
  | 'cat'
  | 'error'
  | 'inventoryUse'
  | 'longPress'
  | 'password'
  | 'success'

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
  }

type VibrationNavigator = Navigator & {
  vibrate?: (pattern: number | number[]) => boolean
}

type CatMeowSegment = {
  duration: number
  offset: number
  playbackRate: number
  volume: number
}

const feedbackKinds = new Set<InteractionFeedbackKind>([
  'button',
  'careAction',
  'cat',
  'error',
  'inventoryUse',
  'longPress',
  'password',
  'success',
])

const vibrationPatterns: Record<InteractionFeedbackKind, number | number[]> = {
  button: 55,
  careAction: [55, 42, 55],
  cat: [48, 36, 48],
  error: [80, 45, 80],
  inventoryUse: [50, 38, 50],
  longPress: [90, 55, 110],
  password: 45,
  success: [48, 34, 70],
}

const catMeowSoundPath = '/sounds/cat-meow.m4a'
const catMeowSegments: CatMeowSegment[] = [
  { duration: 0.96, offset: 0.28, playbackRate: 1.02, volume: 0.72 },
  { duration: 0.92, offset: 3.72, playbackRate: 1, volume: 0.64 },
]

let audioContext: AudioContext | null = null
let catMeowBuffer: AudioBuffer | null = null
let catMeowBufferPromise: Promise<AudioBuffer | null> | null = null

export const isInteractionFeedbackKind = (value: string | undefined): value is InteractionFeedbackKind =>
  Boolean(value && feedbackKinds.has(value as InteractionFeedbackKind))

const getAudioContext = () => {
  if (typeof window === 'undefined') {
    return null
  }

  const AudioContextConstructor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext

  if (!AudioContextConstructor) {
    return null
  }

  audioContext ??= new AudioContextConstructor()
  return audioContext
}

export const vibrateInteractionFeedback = (kind: InteractionFeedbackKind = 'button') => {
  if (typeof navigator === 'undefined') {
    return false
  }

  const vibration = (navigator as VibrationNavigator).vibrate

  if (typeof vibration !== 'function') {
    return false
  }

  try {
    const pattern = vibrationPatterns[kind]
    const vibrateWithPattern: (nextPattern: number | number[]) => boolean =
      vibration.bind(navigator)

    return vibrateWithPattern(pattern)
  } catch {
    return false
  }
}

const playTone = (
  context: AudioContext,
  startAt: number,
  frequency: number,
  duration: number,
  peakVolume: number,
  type: OscillatorType = 'sine',
  endFrequency = frequency,
) => {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const endAt = startAt + duration

  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, startAt)

  if (endFrequency !== frequency) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), endAt)
  }

  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(peakVolume, startAt + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt)

  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(startAt)
  oscillator.stop(endAt + 0.025)
}

const loadCatMeowBuffer = (context: AudioContext) => {
  if (catMeowBuffer) {
    return Promise.resolve(catMeowBuffer)
  }

  catMeowBufferPromise ??= fetch(catMeowSoundPath)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Unable to load ${catMeowSoundPath}`)
      }

      return response.arrayBuffer()
    })
    .then((audioData) => context.decodeAudioData(audioData))
    .then((buffer) => {
      catMeowBuffer = buffer
      return buffer
    })
    .catch(() => {
      catMeowBufferPromise = null
      return null
    })

  return catMeowBufferPromise
}

const playCatMeowSegment = (
  context: AudioContext,
  buffer: AudioBuffer,
  segment: CatMeowSegment,
  startAt: number,
) => {
  const source = context.createBufferSource()
  const gain = context.createGain()
  const endAt = startAt + segment.duration

  source.buffer = buffer
  source.playbackRate.setValueAtTime(segment.playbackRate, startAt)

  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(segment.volume, startAt + 0.035)
  gain.gain.setValueAtTime(segment.volume, Math.max(startAt + 0.04, endAt - 0.08))
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt)

  source.connect(gain)
  gain.connect(context.destination)
  source.start(startAt, segment.offset, segment.duration)
  source.stop(endAt + 0.05)
}

const playSyntheticCatMeow = (context: AudioContext, startAt: number) => {
  playTone(context, startAt, 760, 0.22, 0.045, 'sine', 420)
  playTone(context, startAt + 0.08, 520, 0.24, 0.038, 'sine', 820)
  playTone(context, startAt + 0.03, 1120, 0.16, 0.012, 'triangle', 660)
}

const playSyntheticCatMeowPair = (context: AudioContext) => {
  const now = context.currentTime + 0.012

  playSyntheticCatMeow(context, now)
  playSyntheticCatMeow(context, now + 0.62)
}

const playCatMeowPair = (context: AudioContext) => {
  const playRealMeowPair = (buffer: AudioBuffer | null) => {
    if (!buffer) {
      playSyntheticCatMeowPair(context)
      return
    }

    const now = context.currentTime + 0.012

    catMeowSegments.forEach((segment, index) => {
      playCatMeowSegment(context, buffer, segment, now + index * 1.12)
    })
  }

  if (catMeowBuffer) {
    playRealMeowPair(catMeowBuffer)
    return
  }

  void loadCatMeowBuffer(context).then(playRealMeowPair)
}

const playFeedbackSound = (kind: InteractionFeedbackKind, context: AudioContext) => {
  const now = context.currentTime + 0.012

  if (kind === 'password') {
    playTone(context, now, 860, 0.055, 0.034, 'sine', 1180)
    return
  }

  if (kind === 'careAction') {
    playTone(context, now, 420, 0.075, 0.035, 'triangle', 560)
    playTone(context, now + 0.07, 610, 0.09, 0.028, 'sine', 720)
    return
  }

  if (kind === 'inventoryUse') {
    playTone(context, now, 300, 0.06, 0.036, 'triangle', 420)
    playTone(context, now + 0.055, 760, 0.095, 0.03, 'sine', 620)
    return
  }

  if (kind === 'longPress') {
    playTone(context, now, 360, 0.08, 0.038, 'triangle', 520)
    playTone(context, now + 0.075, 700, 0.12, 0.032, 'sine', 560)
    return
  }

  if (kind === 'cat') {
    playCatMeowPair(context)
    return
  }

  if (kind === 'success') {
    playTone(context, now, 620, 0.075, 0.034, 'sine', 830)
    playTone(context, now + 0.08, 980, 0.12, 0.032, 'triangle', 1180)
    return
  }

  if (kind === 'error') {
    playTone(context, now, 190, 0.13, 0.04, 'sawtooth', 150)
    playTone(context, now + 0.09, 170, 0.12, 0.028, 'sawtooth', 135)
    return
  }

  playTone(context, now, 520, 0.045, 0.03, 'triangle', 650)
}

type PlayInteractionFeedbackOptions = {
  vibrate?: boolean
}

export const playInteractionFeedback = (
  kind: InteractionFeedbackKind = 'button',
  options: PlayInteractionFeedbackOptions = {},
) => {
  let didVibrate = false

  if (options.vibrate ?? true) {
    didVibrate = vibrateInteractionFeedback(kind)
  }

  const context = getAudioContext()

  if (!context) {
    return didVibrate
  }

  const play = () => {
    try {
      if (kind !== 'cat') {
        void loadCatMeowBuffer(context)
      }

      playFeedbackSound(kind, context)
    } catch {
      audioContext = null
    }
  }

  if (context.state === 'suspended') {
    void context.resume().then(play).catch(() => undefined)
    return didVibrate
  }

  play()
  return didVibrate
}
