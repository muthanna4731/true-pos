import { afterEach, describe, expect, it } from 'vitest'
import en from '../src/i18n/en.json'
import kn from '../src/i18n/kn.json'
import { setLang, t } from '../src/i18n'

describe('i18n', () => {
  afterEach(() => setLang('en'))

  it('has every English key in Kannada', () => {
    const missing = Object.keys(en).filter((key) => !(key in kn))
    expect(missing).toEqual([])
  })

  it('fills {vars} into a string', () => {
    expect(t('total', { amount: '₹375' })).toBe('TOTAL ₹375')
  })

  it('returns the Kannada string after setLang("kn")', () => {
    setLang('kn')
    expect(t('cash')).toBe(kn.cash)
    expect(t('cash')).not.toBe(en.cash)
  })

  it('falls back to the key when a string is missing', () => {
    expect(t('no.such.key')).toBe('no.such.key')
  })
})
