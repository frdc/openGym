import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from './i18n.js'

// Explicit form completion shares one owner/lifetime/durable-ack boundary.
export function useDurableSave() {
  const origin = useRef(useStore.getState().getContext())
  const mounted = useRef(false), pending = useRef(false), completed = useRef(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const current = () => {
    const now = useStore.getState().getContext()
    return mounted.current && now.localReady && now.ownerKey === origin.current.ownerKey && now.epoch === origin.current.epoch
  }
  const run = async (mutate, done) => {
    if (pending.current || completed.current || !current()) return
    pending.current = true; setSaving(true)
    try {
      mutate()
      await useStore.getState().flushLocal()
      if (!current()) return
      completed.current = true
      done()
    } catch {
      if (current()) useUI.getState().toast(t('Changes could not be saved on this device. Keep the app open and try again.'))
    } finally { pending.current = false; if (current()) setSaving(false) }
  }
  return { saving, run, current }
}

