import { create } from 'zustand'
import { uid } from '../lib/format.js'
import { beep, chime, vibrate, alertBuzz } from '../lib/sound.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { armRestAlert, bindNativeRest, disarmRestAlert, holdRestAlert } from '../lib/rest-alert.js'
import { useStore } from './useStore.js'
import { REST_MAX } from '../lib/duration.js'
import { accentValue } from '../lib/accent.js'

// Context is authoritative local metadata, never an ID from a workout backup.
const timerContext = () => {
  const { ownerKey, localReady, activeSessionToken } = useStore.getState()
  return { ownerKey, localReady, activeSessionToken }
}
const validContext = context => {
  const current = timerContext()
  return !!context?.localReady && !!context.ownerKey && !!context.activeSessionToken && current.localReady
    && current.ownerKey === context.ownerKey && current.activeSessionToken === context.activeSessionToken
}
const guardedDone = (work, done) => (...args) => { if (validContext(work.context)) done?.(...args) }
const bookRestEnd = (endsAt, totalSec, kind) => {
  const tm = useUI.getState().timer
  if (!MOBILE || !validContext(tm?.context)) return
  const switching = kind === 'switch'
  const { S } = useStore.getState()
  // The adapter serializes native operations and the token follows native actions.
  void armRestAlert(endsAt, { timerToken: tm.timerToken, title: switching ? t('Switch sides') : t('Rest’s over. Next set!'), countdownTitle: switching ? t('Switch sides') : t('Rest'), totalSec, accent: accentValue(S), sound: !!S.sound, vibrate: S.vibrate !== false, alarmBuzz: S.vibrate !== false && !!S.vibrateOnSilent }).catch(() => {})
}

const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window

// Set the moment the tab goes hidden, never cleared here — timerTick/workTick read and
// clear it themselves once they're running visible again. Lets a completion tick tell
// "the countdown hit zero while the app was actually open" from "it hit zero while
// backgrounded/closed and we're only just catching up now that it's open again" — the
// latter must skip beep/vibrate/flash and rely on the alert armed when the rest started
// (a native alarm on the mobile build). The toast still shows
// on reopen so a countdown that vanished does not look like a bug.
let pageHiddenAt = null
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.hidden) pageHiddenAt = Date.now() })
}

// Local browser alerts use an existing permission and never request one during a rest.
const restAlertsOn = async () => Notification.permission === 'granted'

const maybeRestNotification = async timer => {
  if (!notificationsSupported()) return
  if (!document.hidden && document.visibilityState !== 'hidden') return
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.()
    if (!(await restAlertsOn(reg)) || !validContext(timer.context) || useUI.getState().timer?.timerToken !== timer.timerToken) return
    // One local rest alert replaces the preceding one. No body duplicates the title.
    // Android Chrome forbids the Notification constructor (Illegal constructor) - the
    // service-worker registration path is the one that actually pops there.
    const opts = { tag: 'rest-timer', icon: 'icon-512.png' }
    if (reg?.showNotification) { reg.showNotification(t('Rest’s over. Next set!'), opts); return }
    new Notification(t('Rest’s over. Next set!'), opts)
  } catch {
    // Intentionally ignore: notification APIs vary by browser and policy in edge cases.
  }
}

let toastTm = null
const TOAST_MS = 2200
const TOAST_ACTION_MS = 5000
let toastLeft = 0
let toastT0 = 0
let toastPaused = false
let toastSeq = 0
const runToast = set => {
  toastPaused = false
  toastT0 = Date.now()
  clearTimeout(toastTm)
  toastTm = setTimeout(() => set({ toastMsg: '', toastAction: null }), toastLeft)
}
let timerInt = null
let timerTick = null
let workInt = null
let workTick = null
let workDone = null
const MAX_WORK_OVERTIME_SEC = 15 * 60

// The hold's countdown tick, from a start or from a restore after a reload.
const runWork = (set, get) => {
  stopWorkTicking()
  workTick = () => {
    const wk = get().work
    if (!wk) return
    if (!validContext(wk.context)) { get().stopWork(); return }
    const left = Math.max(wk.overtime ? -MAX_WORK_OVERTIME_SEC : 0, Math.round((wk.endsAt - Date.now()) / 1000))
    const seenLive = !document.hidden && pageHiddenAt === null
    if (!document.hidden) pageHiddenAt = null
    if (left === wk.left) return
    const { sound: snd, classicChime } = useStore.getState().S
    if (left <= 0) {
      if (seenLive && !wk.alerted) {
        chime(snd, classicChime)
        alertBuzz([200, 100, 200]); get().flashTimer()
      }
      if (wk.overtime && left > -MAX_WORK_OVERTIME_SEC) { set({ work: { ...wk, left, alerted: true } }); return }
      const done = guardedDone(wk, workDone || ownerDone(wk))
      get().stopWork()
      // `chimed` tells the set's own tick that this end has already sounded and buzzed — not
      // so when overtime ran out, whose end chime played when the target was reached.
      if (done) done(wk.total - left, { chimed: seenLive && !wk.alerted })
      return
    }
    if (left <= 3) beep(snd, 660, 0.1)
    set({ work: { ...wk, left } })
  }
  workInt = setInterval(workTick, 1000)
  document.addEventListener('visibilitychange', workTick)
}
const stopWorkTicking = () => {
  if (workInt) clearInterval(workInt); workInt = null
  if (workTick) document.removeEventListener('visibilitychange', workTick); workTick = null
}
// The set a hold belongs to, while it still is that one: the same exercise at that place in the
// running workout, not ticked off yet.
const ownerSet = o => {
  const e = useStore.getState().S?.active?.entries?.[o?.idx]
  const st = e && e.id === o.id ? e.sets?.[o.i] : null
  return st && !st.done ? st : null
}
// A restored hold that ends before the workout screen is back to bind its handler: the time still
// goes to its set, and a hold that ran out (or got its Done) ticks the set off. No rest follows:
// that is the workout screen's to start, and the hold mostly ended while the app was away.
const ownerDone = wk => !wk?.owner ? null : (elapsed, { abandoned = false } = {}) => {
  if (!validContext(wk.context) || !ownerSet(wk.owner)) return
  const { idx, i } = wk.owner
  useStore.getState().update(s => {
    if (!validContext(wk.context) || !ownerSet(wk.owner)) return
    const st = s.active.entries[idx].sets[i]
    st.sec = elapsed
    if (abandoned) { if (st.planSec == null) st.planSec = wk.total; return }
    delete st.planSec
    if (st.sides) return   // a per-side row is ticked side by side, on the workout screen
    st.done = true
    st.at = Date.now()
  }, true)
}
const stopRestTicking = () => {
  if (timerInt) clearInterval(timerInt); timerInt = null
  if (timerTick) document.removeEventListener('visibilitychange', timerTick); timerTick = null
}
// The rest countdown's tick, from a start or from a resume: the same endsAt-based count either
// way, so a paused rest carries on exactly as a started one runs.
const runRest = (set, get) => {
  stopRestTicking()
  timerTick = () => {
    const tm = get().timer
    if (!tm || tm.ready || tm.paused) return
    if (!validContext(tm.context)) { get().stopRest(); return }
    const left = Math.max(0, Math.round((tm.endsAt - Date.now()) / 1000))
    const seenLive = !document.hidden && pageHiddenAt === null
    if (!document.hidden) pageHiddenAt = null
    if (left === tm.left) return
    const { sound: snd, classicChime } = useStore.getState().S
    if (left <= 0 && tm.kind === 'switch') {
      // Over like a hold is: the chime and its buzz, then the bar goes. No "Ready", no toast:
      // the other side is the next thing, one tap away.
      if (seenLive) { chime(snd, classicChime); alertBuzz([200, 100, 200]); get().flashTimer() }
      stopRestTicking()
      set({ timer: null })
      return
    }
    if (left <= 0) {
      if (seenLive) {
        // The Android alarm for this end stays quiet while the app is on screen, so this chime is
        // the only one. Locked, this branch never runs and the alarm's tone does.
        chime(snd, classicChime)
        alertBuzz([200, 100, 200]); get().flashTimer()
      }
      // The toast stays even when the rest ran out while the app was hidden: a guest, or anyone
      // without push permission, gets no notification, and a countdown that silently vanishes
      // on reopen reads like a bug. Only the loud parts (beep, vibration, flash) are gated.
      // The native alarm is left armed: this tick can come a little early, and with the screen
      // locked it never runs at all.
      get().toast(t('Rest’s over. Next set!'))
      if (!MOBILE) maybeRestNotification(tm)

      stopRestTicking()
      set({ timer: { ...tm, left: 0, ready: true } })
      return
    }
    if (left <= 3) beep(snd, 660, 0.1)
    set({ timer: { ...tm, left } })
  }
  timerInt = setInterval(timerTick, 1000)
  document.addEventListener('visibilitychange', timerTick)
}

export const useUI = create((set, get) => ({
  sheets: [],          // { id, render:(close)=>JSX, kind:'sheet'|'center', locked }
  toastMsg: '',
  toastAction: null,   // { label, run, id } while the toast offers an action (Undo)
  swipeHint: null,     // { idx, i, id }: the set row showing the one-time swipe hint (Workout.jsx)
  setFlash: null,      // { idx, i, id }: the set row a copy or an undo just brought, flashed once
  timer: null,         // rest countdown between sets — { left, total, endsAt, forIdx, ready?, paused?, kind? }
                       // kind: 'switch' for the short pause between the two sides of a timed set
                       // forIdx: index of the active entry whose set started the rest (undefined when unknown)
                       // forSet: index of that set in the entry's rows, so removing the set stops its rest
                       // paused: held at `left`; `endsAt` means nothing until resumeRest sets it again
  work: null,          // work countdown DURING a timed set (issue #16) — { left, total, endsAt, label, overtime? }
  timerFlashId: 0,     // changing the id retriggers the theme-blink visual alert

  flashTimer() {
    if (!useStore.getState().S.timerFlash) return
    set(s => ({ timerFlashId: s.timerFlashId + 1 }))
  },

  openSheet(render, { kind = 'sheet', locked = false, accountAuth = false } = {}) {
    const id = uid()
    set(s => ({ sheets: [...s.sheets, { id, render, kind, locked, accountAuth }] }))
    const close = () => get().closeSheet(id)
    return { id, close, lock: v => set(s => ({ sheets: s.sheets.map(x => x.id === id ? { ...x, locked: v } : x) })) }
  },
  closeSheet(id) { set(s => ({ sheets: s.sheets.filter(x => x.id !== id) })) },
  closeAll() { set({ sheets: [] }) },

  // A toast is 2.2 s of text. With an action (`{ action: 'Undo', onAction }`) it stays 5 s, shows
  // the action as a button at its end and holds still while a finger rests on it (pauseToast). A
  // new toast replaces the one showing, action and all: the old Undo is gone, what it would have
  // undone stays done. The action runs once at most, and the toast goes with it.
  toast(msg, { action, onAction, ms } = {}) {
    const withAction = !!(action && typeof onAction === 'function')
    clearTimeout(toastTm)
    toastLeft = ms || (withAction ? TOAST_ACTION_MS : TOAST_MS)
    toastSeq += 1
    set({ toastMsg: msg, toastAction: withAction ? { label: action, run: onAction, id: toastSeq } : null })
    runToast(set)
  },
  runToastAction() {
    const act = get().toastAction
    if (!act) return
    clearTimeout(toastTm)
    set({ toastMsg: '', toastAction: null })
    act.run()
  },
  pauseToast() {
    if (!get().toastAction || toastPaused) return
    toastPaused = true
    clearTimeout(toastTm)
    toastLeft = Math.max(400, toastLeft - (Date.now() - toastT0))
  },
  resumeToast() {
    if (!toastPaused) return
    toastPaused = false
    if (get().toastMsg) runToast(set)
  },

  startRest(sec, forIdx, { kind, forSet } = {}) {
    const context = timerContext()
    if (!validContext(context)) return
    get().stopRest()
    // Rest timer set to Off. Stopping and returning rather than starting a zero-length timer
    // keeps every caller honest: the four places that start a rest do not each need to know.
    if (!(sec > 0)) return
    // And the hold, the other way round from startWork: the two must never run together (see the
    // work timer below). A set ticked by hand while its hold ran used to leave both going — the
    // rest bar with its Skip and ±15 s hidden behind the hold bar, and then the hold reaching
    // zero under a rest that was still counting down, beeping its own end and logging the full
    // target for a set nobody was holding any more. Below the guard, not above it: a rest that
    // does not start has nothing to run alongside the hold, and taking the hold down for it
    // would throw away a plank in progress for nothing. What it held is kept either way —
    // abandonWork, not stopWork.
    get().abandonWork()
    // Nothing clears pageHiddenAt but a tick, so an app switch with no timer running left it set
    // for good. The next timer's first tick then read it as "this countdown ran out while the app
    // was away" and finished in silence — a one-second rest, started on screen, over on screen,
    // with no beep, no vibration and no flash. Each timer starts from where the page is now.
    pageHiddenAt = document.hidden ? Date.now() : null
    const endsAt = Date.now() + sec * 1000
    retainTimer(REST_KEY)
    set({ timer: { context, timerToken: uid(), left: sec, total: sec, endsAt, forIdx, ...(forSet != null ? { forSet } : {}), ...(kind === 'switch' ? { kind } : {}) } })
    bookRestEnd(endsAt, sec, kind)
    runRest(set, get)
  },
  // Holding the rest where it is — a longer break than planned, a machine to wait for, a phone
  // call (#193). Paused time does not count: the countdown stops, and so does everything that
  // would announce its end — the server's push and the alert this tab shows are cancelled, not
  // left to fire at the old time, and the Android notification stops its clock at the same time
  // with its alarm called off. The timed hold is a different timer and is not touched.
  pauseRest() {
    const tm = get().timer
    if (!tm || tm.ready || tm.paused) return
    if (!validContext(tm.context)) { get().stopRest(); return }
    stopRestTicking()

    const left = Math.max(1, Math.round((tm.endsAt - Date.now()) / 1000))
    holdRestAlert(left, tm.total, tm.timerToken)
    set({ timer: { ...tm, left, paused: true } })
  },
  // Carrying on from where the pause held it: the end moves out by however long the pause was,
  // and the push that announces it is booked again for the new time.
  resumeRest() {
    const tm = get().timer
    if (!tm?.paused || !validContext(tm.context)) return
    const { paused, ...rest } = tm
    // As in startRest: the page may have been hidden and shown while paused, and that is no
    // catch-up of a countdown that was not running.
    pageHiddenAt = document.hidden ? Date.now() : null
    const endsAt = Date.now() + tm.left * 1000
    set({ timer: { ...rest, endsAt } })
    bookRestEnd(endsAt, tm.total, tm.kind)
    runRest(set, get)
  },
  addRest(sec) {
    const tm = get().timer
    if (!tm || !validContext(tm.context)) return
    if (tm.ready) { if (sec > 0) get().startRest(Math.min(sec, REST_MAX), tm.forIdx, { forSet: tm.forSet }); else get().stopRest(); return }
    // +15 s stops where the wheel does (15:00), so the two never disagree about a rest's length.
    if (sec > 0) sec = Math.min(sec, Math.max(0, REST_MAX - tm.left))
    if (!sec) return
    const left = tm.left + sec
    // taking off more than is left means "I'm ready now" — same as skipping, and it keeps a
    // negative duration out of both the progress bar and the server-side push schedule
    if (left <= 0) { get().stopRest(); return }
    // Paused, there is no end to move and nothing booked on the server: the time is simply held,
    // and the notification holds the new figure.
    if (tm.paused) { set({ timer: { ...tm, left, total: tm.total + sec } }); holdRestAlert(left, tm.total + sec, tm.timerToken); return }
    const endsAt = tm.endsAt + sec * 1000
    set({ timer: { ...tm, left, total: tm.total + sec, endsAt } })
    bookRestEnd(endsAt, tm.total + sec, tm.kind)
  },
  // The active list changed shape (an exercise removed or inserted at `at`): keep the rest
  // pointing at the same exercise. Returns nothing; the caller decides whether to stop instead.
  shiftRestOwner(at, delta) {
    const tm = get().timer
    if (!tm || !(tm.forIdx >= at)) return
    set({ timer: { ...tm, forIdx: tm.forIdx + delta } })
  },
  // Android: the rest notification's own Pause, −15 s and +15 s (#296) change the countdown there
  // first, and this brings the bar in the app to the same place — a pause stops the ticking here
  // too, a resume starts it again from the notification's end, and +15 s on a rest the app had
  // already called Ready opens it again. Nothing is sent back: the notification already shows it.
  followNativeRest({ endsAt, left, total, paused }) {
    const tm = get().timer
    if (!tm || !validContext(tm.context)) return
    const forIdx = tm.forIdx
    const kind = { ...(tm?.kind === 'switch' ? { kind: 'switch' } : {}), ...(tm?.forSet != null ? { forSet: tm.forSet } : {}) }
    if (paused) {
      stopRestTicking()
      set({ timer: { context: tm.context, timerToken: tm.timerToken, left, total, endsAt, forIdx, ...kind, paused: true } })
      return
    }
    const ticking = !!timerInt && !!tm && !tm.paused && !tm.ready
    set({ timer: { context: tm.context, timerToken: tm.timerToken, left, total, endsAt, forIdx, ...kind } })
    if (ticking) return
    // As in resumeRest: a hide from while it was held or over is no catch-up of this countdown.
    pageHiddenAt = document.hidden ? Date.now() : null
    runRest(set, get)
  },
  stopRest() {
    stopRestTicking()
    // Skip, Dismiss, a rest replacing this one and "rest off" all take the native alarm and
    // its notifications down with it, or the alert fires after the user already moved on.
    disarmRestAlert(get().timer?.timerToken)

    set({ timer: null })
  },

  /* ---- work timer (issue #16) ----
     Times the set itself, not the recovery after it. Kept separate from the rest timer on
     purpose: the two mean opposite things, they must never run together, and a work set is
     something you are watching — so it gets no server push (that endpoint says "rest over",
     and a plank does not need a notification you are staring at anyway).
     `onDone(elapsedSec, { chimed, abandoned })` is called both when the countdown reaches zero and
     on an early finish; the elapsed time is what actually gets logged, so stopping at 0:38 of a
     0:45 hold records 0:38 rather than crediting the full target. `chimed` is true when the
     countdown ran out in front of you and the end chime and buzz have just played; `abandoned`
     when a rest displaced the hold (abandonWork).
     `owner` ({ idx, i, id }: the active entry and set being held) lets a hold outlive a reload or
     the app being killed (restoreWork below). onDone is a closure and cannot be kept, so the owner
     says where the time goes, and the workout screen binds its handler again (bindWork). */
  startWork(sec, label, onDone, owner = null) {
    const context = timerContext()
    if (!validContext(context)) return
    get().abandonWork()   // a hold this one replaces keeps what it held, same as a rest replacing one
    get().stopRest()
    const total = Math.max(1, Math.round(sec) || 1)
    const endsAt = Date.now() + total * 1000
    workDone = onDone
    pageHiddenAt = document.hidden ? Date.now() : null   // see startRest: a stale hide is not a catch-up
    retainTimer(WORK_KEY)
    set({ work: { context, left: total, total, endsAt, label, overtime: useStore.getState().S.timedSetOvertime === true, ...(owner ? { owner } : {}) } })
    runWork(set, get)
  },
  // The workout screen, back on a hold restored after a reload: `make(work)` gives it the handler
  // its own start would have. Nothing to do for a hold that has one, or whose set is gone.
  bindWork(make) {
    const wk = get().work
    if (!wk?.owner || workDone || !validContext(wk.context) || !ownerSet(wk.owner)) return
    workDone = make(wk)
  },
  // Ended the hold early — log what was actually held.
  finishWorkEarly() {
    const wk = get().work
    if (!wk) return
    if (!validContext(wk.context)) { get().stopWork(); return }
    const startedAt = wk.endsAt - wk.total * 1000
    const elapsed = Math.max(1, Math.min(wk.total + (wk.overtime ? MAX_WORK_OVERTIME_SEC : 0), Math.round((Date.now() - startedAt) / 1000)))
    const done = guardedDone(wk, workDone || ownerDone(wk))
    vibrate(30)
    get().stopWork()
    if (done) done(elapsed)
  },
  // A rest is starting while a hold runs that is not the one being ticked — a set finished on
  // another row, or on another exercise, which the List layout puts one tap away. The hold cannot
  // survive (the two must never run together) but the time it held is real, so it is handed back
  // before it goes and its own row keeps it. The `abandoned` flag tells the owner this was not a
  // finish: the row is not ticked off and earns no rest of its own, since the rest that displaced
  // the hold is the one now running.
  abandonWork() {
    const wk = get().work
    if (!wk) { get().stopWork(); return }
    if (!validContext(wk.context)) { get().stopWork(); return }
    const elapsed = wk.total - wk.left
    const done = guardedDone(wk, workDone || ownerDone(wk))
    get().stopWork()
    // Under two seconds there is nothing to keep: that is a play button tapped by accident, or
    // tapped and thought better of, and rounding it up to one second the way an early finish does
    // would write a one-second plank over a real plan. (finishWorkEarly's Math.max(1, …) is right
    // for what it is: you pressed Done, so you held it, however briefly.)
    if (done && elapsed >= 2) done(elapsed, { abandoned: true })
  },
  // Abandon without logging anything.
  stopWork() {
    stopWorkTicking()
    workDone = null
    set({ work: null })
  }
}))

// A reload in the middle of a rest (pull to refresh, a WebView restart, an update) used to drop
// the countdown while its alarm still rang later. The rest lives on in localStorage and comes
// back at boot while its end is still ahead, held if it was paused. Not sessionStorage: that
// dies with the process, and Android killing the app mid-rest (or iOS dropping the home-screen
// app) took the bar with it. On the web its end was booked when it started (the server's push,
// per device, which survives the reload), so it is not booked again: the alert fires once, and
// the bar's own tick at zero calls the push off as it always does. In the app the countdown
// notification lives in the app's process and may be gone with it, so the end is booked again
// there: the alarm has a fixed id and the new booking replaces the old one, it never adds a second.
// A rest that ended meanwhile, or one left with no session running, is dropped.
export const REST_KEY = 'gym_rest'
const restStore = () => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
const protectedTimerRecords = new Map()
const protectedRecord = (storage, key) => {
  const raw = protectedTimerRecords.get(key)
  if (!raw) return false
  if (storage.getItem(key) === raw) return true
  protectedTimerRecords.delete(key)
  return false
}
const saveRest = tm => {
  const ss = restStore()
  if (!ss) return
  try {
    if (protectedRecord(ss, REST_KEY)) return
    if (!tm || tm.ready) ss.removeItem(REST_KEY)
    else ss.setItem(REST_KEY, JSON.stringify({ context: tm.context, timerToken: tm.timerToken, endsAt: tm.endsAt, total: tm.total, forIdx: tm.forIdx ?? null, forSet: tm.forSet ?? null, kind: tm.kind || null, paused: !!tm.paused, left: tm.left }))
  } catch { /* the rest just does not outlive a reload */ }
}
export function restoreRest(now = Date.now()) {
  const ss = restStore()
  let saved = null
  try { saved = JSON.parse(ss?.getItem(REST_KEY) || 'null') } catch { saved = null }
  if (!saved || useUI.getState().timer || !validContext(saved.context)) return false
  const total = Math.round(Number(saved.total))
  const ok = useStore.getState().S?.active && total > 0 && (saved.paused ? saved.left > 0 : saved.endsAt > now)
  if (!ok) { try { ss.removeItem(REST_KEY) } catch { /* nothing to drop */ } return false }
  const base = { context: saved.context, timerToken: saved.timerToken || uid(), total, forIdx: saved.forIdx ?? undefined, ...(saved.forSet != null ? { forSet: saved.forSet } : {}), ...(saved.kind === 'switch' ? { kind: 'switch' } : {}) }
  if (saved.paused) {
    useUI.setState({ timer: { ...base, left: Math.round(saved.left), endsAt: saved.endsAt, paused: true } })
    if (MOBILE) holdRestAlert(Math.round(saved.left), total, base.timerToken)
    return true
  }
  pageHiddenAt = typeof document !== 'undefined' && document.hidden ? now : null
  useUI.setState({ timer: { ...base, left: Math.max(1, Math.round((saved.endsAt - now) / 1000)), endsAt: saved.endsAt } })
  if (MOBILE) bookRestEnd(saved.endsAt, total, base.kind)
  runRest(useUI.setState, useUI.getState)
  return true
}
useUI.subscribe((s, prev) => { if (s.timer !== prev.timer) saveRest(s.timer) })
restoreRest()

// The hold (a timed set) the same way: a reload or the app being killed mid-plank used to drop
// the bar and the seconds with it. Kept beside the rest, with the set it belongs to (`owner`);
// at boot it carries on while its end is ahead, and one that ended meanwhile is written to its set
// as held to the end. The workout screen binds its own handler again (bindWork), and until it
// does the time still lands on the set (ownerDone). Only the start, total and owner are kept:
// the tick reads `endsAt`, so what it shows after the reload is what the clock says.
export const WORK_KEY = 'gym_work'
const saveWork = wk => {
  const ls = restStore()
  if (!ls) return
  try {
    if (protectedRecord(ls, WORK_KEY)) return
    if (!wk?.owner) ls.removeItem(WORK_KEY)
    else ls.setItem(WORK_KEY, JSON.stringify({ context: wk.context, endsAt: wk.endsAt, total: wk.total, label: wk.label || '', overtime: !!wk.overtime, alerted: !!wk.alerted, owner: wk.owner }))
  } catch { /* the hold just does not outlive a reload */ }
}
export function restoreWork(now = Date.now()) {
  const ls = restStore()
  let saved = null
  try { saved = JSON.parse(ls?.getItem(WORK_KEY) || 'null') } catch { saved = null }
  if (!saved || useUI.getState().work || !validContext(saved.context)) return false
  const total = Math.round(Number(saved.total))
  const drop = () => { try { ls.removeItem(WORK_KEY) } catch { /* nothing to drop */ } return false }
  if (!(total > 0) || !(saved.endsAt > 0) || !ownerSet(saved.owner)) return drop()
  const wk = { context: saved.context, left: total, total, endsAt: saved.endsAt, label: saved.label || '', overtime: !!saved.overtime, ...(saved.alerted ? { alerted: true } : {}), owner: saved.owner }
  const left = Math.round((saved.endsAt - now) / 1000)
  // Over while the app was away: held to the end (overtime past the target is not known, and
  // the target is what was planned), with no chime for an end nobody was there for.
  if (left <= 0 && !(wk.overtime && left > -MAX_WORK_OVERTIME_SEC)) {
    drop()
    ownerDone(wk)(total)
    return true
  }
  pageHiddenAt = typeof document !== 'undefined' && document.hidden ? now : null
  useUI.setState({ work: { ...wk, left, ...(left <= 0 ? { alerted: true } : {}) } })
  runWork(useUI.setState, useUI.getState)
  return true
}
useUI.subscribe((s, prev) => { if (s.work !== prev.work && (!s.work || !prev.work || s.work.owner !== prev.work.owner || s.work.endsAt !== prev.work.endsAt || s.work.alerted !== prev.work.alerted)) saveWork(s.work) })
restoreWork()

// Buttons on the rest notification (pause, ±15s, skip) change the countdown in the
// service first, then mirror that into the in-app timer. skip ends it. Seconds round up, as the
// notification's clock does, so a pause in the last half second still holds a second here.
bindNativeRest(ev => {
  const timer = useUI.getState().timer
  if (!ev || !validContext(timer?.context) || !ev.timerToken || ev.timerToken !== timer.timerToken) return
  if (ev.type === 'skip') { useUI.getState().stopRest(); return }
  const left = Math.ceil((ev.leftMs || 0) / 1000)
  if (!(left > 0)) return
  const total = Math.max(left, Math.round((ev.totalMs || 0) / 1000))
  useUI.getState().followNativeRest({ endsAt: ev.endsAt, left, total, paused: !!ev.paused })
})

// Preserve displaced records for explicit recovery; never bind unscoped legacy timers.
function retainTimer(key) {
  const storage = restStore()
  let raw
  try {
    raw = storage?.getItem(key)
    if (!raw) { protectedTimerRecords.delete(key); return }
    const copies = JSON.parse(storage.getItem('gym_timer_recovery') || '[]')
    if (!copies.some(copy => copy.key === key && copy.raw === raw)) copies.push({ key, raw })
    storage.setItem('gym_timer_recovery', JSON.stringify(copies))
    protectedTimerRecords.delete(key)
  } catch { if (raw) protectedTimerRecords.set(key, raw) }
}
useStore.subscribe((state, previous) => {
  const changed = state.ownerKey !== previous.ownerKey || state.activeSessionToken !== previous.activeSessionToken || state.localReady !== previous.localReady
  if (!changed) return
  const ui = useUI.getState()
  if (ui.work && !validContext(ui.work.context)) { retainTimer(WORK_KEY); ui.stopWork() }
  if (ui.timer && !validContext(ui.timer.context)) { retainTimer(REST_KEY); ui.stopRest() }
  if (state.localReady) { restoreWork(); restoreRest() }
})
