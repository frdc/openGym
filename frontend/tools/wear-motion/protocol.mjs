const finite = value => typeof value === 'number' && Number.isFinite(value)
const vector = (value, length) => value === null || (Array.isArray(value) && value.length === length && value.every(n => finite(n) && Math.abs(n) <= 1e6))
const session = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value)
const orientations = new Set(['game_rotation_vector', 'rotation_vector', 'unavailable'])

/** Bounded newline protocol; never let a stale or malformed frame become a live pose. */
export class MotionDecoder {
  pending = ''
  hello = null
  seq = -1
  time = -1
  push(chunk) {
    this.pending += chunk
    const messages = []
    let end
    while ((end = this.pending.indexOf('\n')) >= 0) {
      if (end > 8192) throw Error('Motion line too large')
      const line = this.pending.slice(0, end).trim()
      this.pending = this.pending.slice(end + 1)
      if (!line) continue
      let value
      try { value = JSON.parse(line) } catch { throw Error('Invalid JSON from watch') }
      messages.push(this.validate(value))
    }
    if (this.pending.length > 8192) throw Error('Motion line too large')
    return messages
  }
  validate(value) {
    if (!value || value.v !== 1 || !session(value.session)) throw Error('Invalid protocol version/session')
    if (value.type === 'hello') {
      if (this.hello || typeof value.model !== 'string' || value.model.length > 128 || !orientations.has(value.orientation)
        || value.rateHz !== 25 || !value.sensors || !['orientation', 'accel', 'gyro', 'linear'].every(key => typeof value.sensors[key] === 'boolean')) throw Error('Invalid hello')
      this.hello = value
      return value
    }
    if (value.type !== 'sample') throw Error('Invalid message type')
    if (!this.hello) throw Error('Missing hello')
    if (value.session !== this.hello.session) throw Error('Invalid session')
    if (!Number.isSafeInteger(value.seq) || value.seq <= this.seq || !finite(value.tMs) || value.tMs < 0 || value.tMs < this.time) throw Error('Invalid sample order')
    if (!vector(value.q, 4) || !vector(value.accel, 3) || !vector(value.gyro, 3) || !vector(value.linear, 3)
      || !Number.isInteger(value.accuracy) || value.accuracy < 0 || value.accuracy > 3
      || (value.q === null ? value.orientationAgeMs !== null : !finite(value.orientationAgeMs) || value.orientationAgeMs < 0)) throw Error('Invalid sensor data')
    if (value.q && Math.abs(Math.hypot(...value.q) - 1) > .01) throw Error('Invalid quaternion')
    this.seq = value.seq; this.time = value.tMs
    return value
  }
}
