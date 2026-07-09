import { useCallback, useEffect, useState } from 'react'
import { usePetStore } from '../hooks/usePetStore'
import { createPasswordSalt, hashNumericPassword, normalizeNumericPassword } from '../utils/auth'
import { playInteractionFeedback } from '../utils/interactionFeedback'

type PasswordField = 'confirm' | 'primary'

const keypadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '清空', '0', '退格']

const maskPassword = (value: string) => (value ? '•'.repeat(value.length) : '')

export const AuthGate = () => {
  const {
    completeFirstRunSetup,
    hasPassword,
    isSessionUnlocked,
    isStoreReady,
    meta,
    pet,
    unlockSession,
  } = usePetStore()
  const [petName, setPetName] = useState(pet.name)
  const [userName, setUserName] = useState(meta.userName)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [activePasswordField, setActivePasswordField] = useState<PasswordField>('primary')
  const [errorText, setErrorText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSetupMode = isStoreReady && !hasPassword

  useEffect(() => {
    setPetName(pet.name)
  }, [pet.name])

  useEffect(() => {
    setUserName(meta.userName)
  }, [meta.userName])

  const updateActivePassword = useCallback((updater: (current: string) => string) => {
    if (!isSetupMode || activePasswordField === 'primary') {
      setPassword((current) => normalizeNumericPassword(updater(current)))
      return
    }

    setConfirmPassword((current) => normalizeNumericPassword(updater(current)))
  }, [activePasswordField, isSetupMode])

  const handleKeypadPress = useCallback((key: string) => {
    setErrorText('')

    if (key === '清空') {
      updateActivePassword(() => '')
      return
    }

    if (key === '退格') {
      updateActivePassword((current) => current.slice(0, -1))
      return
    }

    updateActivePassword((current) => `${current}${key}`)
  }, [updateActivePassword])

  const handleSetup = useCallback(async () => {
    const nextPetName = petName.trim()
    const nextUserName = userName.trim()

    if (!nextPetName || !nextUserName) {
      setErrorText('先把猫猫名字和你的名字填好。')
      return
    }

    if (password.length < 4) {
      setErrorText('密码至少需要 4 位数字。')
      return
    }

    if (password !== confirmPassword) {
      setErrorText('两次输入的密码不一样。')
      return
    }

    setIsSubmitting(true)
    const passwordSalt = createPasswordSalt()
    const passwordHash = await hashNumericPassword(password, passwordSalt)
    try {
      await completeFirstRunSetup({
        passwordHash,
        passwordSalt,
        petName: nextPetName,
        userName: nextUserName,
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [completeFirstRunSetup, confirmPassword, password, petName, userName])

  const handleLogin = useCallback(async () => {
    if (!hasPassword) {
      return
    }

    setIsSubmitting(true)
    try {
      const isUnlocked = await unlockSession(password)

      if (!isUnlocked) {
        setErrorText('密码不对，再试一次。')
        setPassword('')
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [hasPassword, password, unlockSession])

  const handleSubmit = useCallback(() => {
    void (isSetupMode ? handleSetup() : handleLogin())
  }, [handleLogin, handleSetup, isSetupMode])

  useEffect(() => {
    if (!isStoreReady || isSubmitting) {
      return
    }

    const handleKeyboardInput = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return
      }

      if (
        target instanceof HTMLButtonElement &&
        (target.classList.contains('number-key') || target.classList.contains('auth-submit'))
      ) {
        return
      }

      if (/^\d$/.test(event.key)) {
        event.preventDefault()
        playInteractionFeedback('password')
        handleKeypadPress(event.key)
        return
      }

      if (event.key === 'Backspace') {
        event.preventDefault()
        playInteractionFeedback('password')
        handleKeypadPress('退格')
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        playInteractionFeedback('password')
        handleKeypadPress('清空')
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        playInteractionFeedback('button')
        handleSubmit()
      }
    }

    window.addEventListener('keydown', handleKeyboardInput)

    return () => {
      window.removeEventListener('keydown', handleKeyboardInput)
    }
  }, [
    handleKeypadPress,
    handleSubmit,
    isStoreReady,
    isSubmitting,
  ])

  if (isSessionUnlocked) {
    return null
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div className="auth-hero" aria-hidden="true">
          <img alt="" className="auth-hero__image" src="/favicon.svg" />
          <p className="auth-hero__version">V{__APP_VERSION__}</p>
        </div>

        <div className="auth-copy">
          <p className="eyebrow">小猫成长记</p>
          <h1>{isStoreReady ? (isSetupMode ? '第一次见面' : '欢迎回来') : '正在准备'}</h1>
          <p className={isStoreReady && isSetupMode ? 'auth-copy__description--stacked' : ''}>
            {isStoreReady
              ? isSetupMode
                ? (
                    <>
                      <span>先给小猫和自己起个名字</span>
                      <span>再设置一个数字密码</span>
                    </>
                  )
                : '输入数字密码，就可以继续陪小猫成长。'
              : '正在读取存档，请稍等一下。'}
          </p>
        </div>

        {isStoreReady ? (
          <>
            {isSetupMode ? (
              <div className="auth-fields">
                <label className="field">
                  <span>猫猫名字</span>
                  <input
                    autoComplete="off"
                    maxLength={12}
                    onChange={(event) => setPetName(event.target.value)}
                    placeholder="比如 小团团"
                    type="text"
                    value={petName}
                  />
                </label>

                <label className="field">
                  <span>你的名字</span>
                  <input
                    autoComplete="name"
                    maxLength={12}
                    onChange={(event) => setUserName(event.target.value)}
                    placeholder="比如 眠眠"
                    type="text"
                    value={userName}
                  />
                </label>
              </div>
            ) : null}

            <div className="password-fields">
              <div className="password-display">
                <span>{isSetupMode ? '设置密码' : '输入密码'}</span>
                <button
                  aria-label={isSetupMode ? '设置密码' : '输入密码'}
                  aria-pressed={activePasswordField === 'primary'}
                  className="password-display__control"
                  data-feedback-kind="password"
                  onClick={() => {
                    setActivePasswordField('primary')
                    setErrorText('')
                  }}
                  type="button"
                >
                  <strong aria-hidden="true">{maskPassword(password) || '----'}</strong>
                </button>
              </div>

              {isSetupMode ? (
                <div className="password-display">
                  <span>再输一次</span>
                  <button
                    aria-label="再输一次密码"
                    aria-pressed={activePasswordField === 'confirm'}
                    className="password-display__control"
                    data-feedback-kind="password"
                    onClick={() => {
                      setActivePasswordField('confirm')
                      setErrorText('')
                    }}
                    type="button"
                  >
                    <strong aria-hidden="true">
                      {maskPassword(confirmPassword) || '----'}
                    </strong>
                  </button>
                </div>
              ) : null}
            </div>

            <div className="number-pad" aria-label="数字输入键盘">
              {keypadKeys.map((key) => (
                <button
                  className={key.length === 1 ? 'number-key' : 'number-key number-key--utility'}
                  data-feedback-kind="password"
                  key={key}
                  onClick={() => handleKeypadPress(key)}
                  type="button"
                >
                  {key}
                </button>
              ))}
            </div>

            {errorText ? <p className="auth-error">{errorText}</p> : null}

            <button
              className="primary-button auth-submit"
              disabled={isSubmitting}
              onClick={handleSubmit}
              type="button"
            >
              {isSetupMode ? '开始陪伴' : '进入小家'}
            </button>
          </>
        ) : (
          <div className="auth-loading" aria-label="读取中" />
        )}
      </section>
    </main>
  )
}
