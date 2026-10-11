import { afterEach, describe, expect, it } from 'vitest'
import { CATALOGUE, EXDB, EXIDX, matchExercise, searchExercises, searchScore } from './exercises.js'
import { _setLangState, exerciseNameFor } from './i18n-core.js'
import ptBR from '../exercise-names/pt-BR.js'
import { EXERCISE_MACHINE_ALIASES } from './exercise-machine-aliases.js'

afterEach(() => _setLangState('en', {}, null, null))

describe('equipment names as exercise aliases', () => {
  it.each(['Triceps Press', 'TRÍCEPS PRESS', 'tricepspress', 'triceps-press'])(
    'makes the seated dip visible in the first results for %s', query => {
      const results = searchExercises(CATALOGUE, query)
      expect(results.slice(0, 2).map(ex => ex.id)).toContain('1451')
      expect(matchExercise(EXIDX['1451'], query)).toBe(true)
    }
  )

  it('keeps the existing ID, name and media, and still finds the original title', () => {
    const raw = EXDB.find(ex => ex.id === '1451')
    const exercise = EXIDX['1451']
    expect(exercise.aliases).toContain('Triceps Press')
    for (const key of ['id', 'n', 'img', 'gif']) expect(exercise[key]).toBe(raw[key])
    expect(raw.aliases).toBeUndefined()
    expect(searchExercises(CATALOGUE, raw.n)).toContain(exercise)
    expect(exerciseNameFor(exercise)).toBe('lever seated dip')
  })

  it('finds aliases after language and name-display settings change', () => {
    const exercise = EXIDX['1451']
    _setLangState('pt-BR', {}, null, ptBR, false)
    expect(exerciseNameFor(exercise)).toBe(ptBR['1451'])
    expect(searchExercises(CATALOGUE, 'Triceps Press').slice(0, 2)).toContain(exercise)
    _setLangState('en', {}, null, null)
    expect(exerciseNameFor(exercise)).toBe('lever seated dip')
    expect(searchExercises(CATALOGUE, 'Triceps Press').slice(0, 2)).toContain(exercise)
  })

  it('uses aliases for name typos and queries that also specify equipment', () => {
    const exercise = { id: 'custom-dip', n: 'My dip', eq: 'leverage machine', aliases: ['Triceps Press'] }
    expect(searchExercises([exercise], 'tricep press')).toEqual([exercise])
    expect(searchExercises([exercise], 'trieps press')).toEqual([exercise])
    expect(searchExercises([exercise], 'Triceps Press leverage')).toEqual([exercise])
    expect(searchScore(exercise, 'Triceps Press')).toBeGreaterThan(0)
  })

  it('does not join the end of one name to the start of another', () => {
    const exercise = { id: 'custom', n: 'My dip', aliases: ['Triceps Press', 'Chest Press'] }
    expect(matchExercise(exercise, 'diptriceps')).toBe(false)
    expect(matchExercise(exercise, 'presschest')).toBe(false)
  })

  it('preserves ordinary result order while promoting only full alias matches', () => {
    const indirect = { id: 'a', n: 'Chest press', sm: ['triceps'] }
    const exact = { id: 'b', n: 'My dip', aliases: ['Triceps Press'] }
    const another = { id: 'c', n: 'Triceps press exercise' }
    const list = [indirect, exact, another]
    expect(searchExercises(list, 'Triceps Press')).toEqual([exact, indirect, another])
    expect(searchExercises(list, 'press')).toEqual(list)
    expect(searchExercises(list, '')).toBe(list)
  })

  it('does not give builtin equipment aliases to a custom exercise with the same ID', () => {
    expect(matchExercise({ id: '1451', n: 'My stretch', custom: true }, 'Triceps Press')).toBe(false)
  })

  it('assigns each mode of a dual machine to the corresponding exercise', () => {
    expect(EXIDX['0597'].aliases).toContain('Abductor')
    expect(EXIDX['0597'].aliases).not.toContain('Adductor')
    expect(EXIDX['0598'].aliases).toContain('Adductor')
    expect(EXIDX['0598'].aliases).not.toContain('Abductor')
    expect(EXIDX['0585'].aliases).toContain('Leg Extension')
    expect(EXIDX['0585'].aliases).not.toContain('Seated Leg Curl')
    expect(EXIDX['0599'].aliases).toContain('Seated Leg Curl')
    expect(EXIDX['0599'].aliases).not.toContain('Leg Extension')
  })

  it('keeps ambiguous media and general apparatus compatibility out of the alias overlay', () => {
    for (const id of ['0603', '0578', '1349', '1385', '0738', '1391', '1392']) {
      expect(EXERCISE_MACHINE_ALIASES[id], id).toBeUndefined()
    }
  })

  it('finds assisted exercises under Graviton without adding ordinary bodyweight pull-ups', () => {
    expect(searchExercises(CATALOGUE, 'Graviton').map(ex => ex.id).sort()).toEqual(['0009', '0015', '0017', '0019', '0572'])
    expect(EXIDX['0652'].aliases || []).not.toContain('Graviton')
  })

  it('finds every curated alias using valid existing IDs and preserves canonical media', () => {
    for (const [id, aliases] of Object.entries(EXERCISE_MACHINE_ALIASES)) {
      const raw = EXDB.find(ex => ex.id === id)
      expect(raw, id).toBeTruthy()
      for (const key of ['id', 'n', 'img', 'gif']) expect(EXIDX[id][key], `${id}: ${key}`).toBe(raw[key])
      expect(raw.aliases, id).toBeUndefined()
      for (const alias of aliases) {
        expect(alias.trim(), id).toBeTruthy()
        expect(searchExercises(CATALOGUE, alias), `${id}: ${alias}`).toContain(EXIDX[id])
      }
    }
  })
})
