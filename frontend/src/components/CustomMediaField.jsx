// The editor's part of a custom exercise's photo, GIF or video, and its link (CustomExForm in
// sheets.jsx). The row follows #295's picture field (horusglez) — the thumb of the draft, a
// tinted Add/Change and a ghost Remove — and the link field is #246's (Vaibhav159).
//
// Picked bytes are ingested and stored locally before an owner-bound draft is attached.
// Open editors hold their originals and posters; abandoned bytes are retained while safe
// physical garbage collection is deferred.
//
// The file input accepts image/* and video/* and nothing more specific: iOS converts a HEIC
// photo to JPEG only when the page does not explicitly ask for HEIC, and every format is checked
// on its bytes anyway.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { mediaOf, fmtClip } from '../lib/media-refs.js'
import { captureMediaContext } from '../lib/local-media.js'
import { DEFAULT_LIMITS, fmtMB, MB } from '../lib/media-limits.js'
import { CustomThumb } from './CustomMedia.jsx'
import { Row, Button } from './ui.jsx'
import Icon from './Icon.jsx'

const toast = m => useUI.getState().toast(m)

// A write the local store refused for room — IndexedDB's quota (Firefox names it its own way), or
// a full phone under the file store. The file itself was fine; saying the browser cannot read it
// would send someone looking for a different file.
const noRoom = e => e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || /ENOSPC|no space left/i.test(String(e?.message || ''))

/** The sentence for a refused file (MediaError codes from lib/media-ingest.js), or for a device
 *  that had no room to keep it. */
export function mediaErrorText(e) {
  if (noRoom(e)) return t('There is no room left on this device for that file.')
  switch (e?.code) {
    case 'type': return t('That file type isn’t supported. Use a photo, a GIF, or an MP4, MOV or WebM video.')
    case 'too-large': return t('That file is too big. Max {0} MB.', fmtMB(e.mb))
    case 'too-long': return t('That video is too long. Max {0} seconds.', e.sec)
    case 'photo-too-big': return t('That photo is too large to process on this device.')
    case 'offline': return t('You’re offline. Try again once you’re back online.')
    default: return t('This browser cannot read that file.')
  }
}

// The ingest is split off and loaded on first use. A failed load is not remembered here, so the
// next pick (back online) tries again.
const loadIngest = () => import('../lib/media-ingest.js').catch(() => {
  throw Object.assign(new Error('media ingest did not load'), { code: 'offline' })
})

const KIND_ICON = { image: 'image', gif: 'play', video: 'play' }

/** Shared local picker. Capture owner+epoch before decoder/storage awaits and reject stale
 * results. Persistent storage and actual local hydration are required for new originals. */
export function useMediaPicker() {
  const ownerKey = useStore(s => s.ownerKey)
  const localReady = useStore(s => s.localReady)
  const epoch = useStore(s => s.getContext().epoch)
  const [busy, setBusy] = useState(false)
  const [warning, setWarning] = useState(null)
  const [storable, setStorable] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let alive = true
    const captured = captureMediaContext(useStore)
    setStorable(false); setBusy(false); setWarning(null)
    if (captured) captured.media.ready().then(() => {
      if (alive && captured.current()) setStorable(captured.media.persistent)
    }).catch(() => { if (alive && captured.current()) setStorable(false) })
    return () => { alive = false }
  }, [ownerKey, epoch, localReady])
  const pick = async file => {
    const captured = captureMediaContext(useStore)
    if (!file || !captured) return null
    const current = () => mounted.current && captured.current()
    setBusy(true); setWarning(null)
    try {
      await captured.media.ready()
      if (!current() || !captured.media.persistent) return null
      const { ingestMediaFile } = await loadIngest()
      if (!current()) return null
      const out = await ingestMediaFile(file, DEFAULT_LIMITS)
      if (!current()) return null
      for (const b of out.blobs) {
        await captured.media.put(b.hash, b.blob, { mime: b.mime, pending: false })
        if (!current()) return null
      }
      try { globalThis.navigator?.storage?.persist?.()?.catch?.(() => {}) } catch { /* optional */ }
      if (out.warnings.includes('codec')) setWarning(t('This video may not play on every device. MP4 (H.264) plays everywhere.'))
      return out.media
    } catch (e) { if (current()) toast(mediaErrorText(e)); return null }
    finally { if (current()) setBusy(false) }
  }
  const note = !storable ? t('This browser cannot store photos or videos here.')
    : t('Kept on this device only. Export with photos & videos keeps a copy.')
  return { pick, busy, warning, setWarning, note, storable, showAdd: true, canAdd: localReady && !busy && storable }
}

export default function CustomMediaField({ media, url, onChange }) {
  const { pick, busy, warning, setWarning, note, showAdd, canAdd } = useMediaPicker()
  const origin = useRef(captureMediaContext(useStore))
  const fileRef = useRef(null)
  const m = mediaOf({ media })
  // The draft's files stay out of the local clean-up for as long as this form is open: its
  // refs are retained even for forms left open beyond the recent-file grace period.
  const mainHash = m?.hash, posterHash = m?.poster?.hash
  useEffect(() => {
    if (!mainHash) return undefined
    if (!origin.current?.current()) return
    return origin.current.media.hold([mainHash, posterHash])
  }, [mainHash, posterHash])

  const onFile = async ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''   // picking the same file again still fires onChange
    if (!origin.current?.current()) return
    const got = await pick(file)
    if (got && origin.current.current()) onChange({ media: got })
  }

  // "0:07 · 2.4 MB": the length of a clip or an animation, and the size of the file itself (the
  // unit through the packs' own "{0} MB", so it reads Mo, МБ, م.ب where it should, and the
  // number with the language's own decimal mark).
  const sizeLine = m ? [m.dur != null && m.kind !== 'image' ? fmtClip(m.dur) : null, t('{0} MB', fmtMB(Math.max(0.1, m.size / MB), { fixed: true }))].filter(Boolean).join(' · ') : null
  const subtitle = m
    ? <span className="cmf-sub"><Icon name={KIND_ICON[m.kind]} />{sizeLine}</span>
    : t('Optional. A picture makes it easier to spot in a list.')

  return <div className="cmf">
    <Row icon="image" iconTint="var(--blue)" title={t('Photo, GIF or video')} subtitle={subtitle}>
      <div className="cmf-act">
        {m && <span className="cmf-thumb"><CustomThumb ex={{ custom: true, media: m }} /></span>}
        {/* The storage note explains why Add is disabled on a nonpersistent backend. */}
        {showAdd && <Button variant="tinted" size="sm" icon={busy ? undefined : 'image'} disabled={!canAdd} onClick={() => fileRef.current?.click()}>
          {busy ? t('Loading…') : m ? t('Change') : t('Add')}
        </Button>}
        {m && <Button variant="ghost" size="sm" icon="xmark" aria-label={t('Remove')} title={t('Remove')} disabled={busy} onClick={() => { setWarning(null); onChange({ media: null }) }} />}
      </div>
    </Row>
    <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={onFile} />
    {warning && <div className="small dim cmf-note">{warning}</div>}
    {note && <div className="small dim cmf-note">{note}</div>}
    <input className="input cmf-link" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
      dir={url ? 'ltr' : undefined} placeholder={t('Video or guide link (optional)')}
      value={url || ''} onChange={e => onChange({ url: e.target.value })} />
  </div>
}
