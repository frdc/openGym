import http from 'node:http'
import net from 'node:net'
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { MotionDecoder } from './protocol.mjs'

const exec = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const activity = 'com.fredc.opengym.test/com.fredc.opengym.WearMotionActivity'
const sdkAdb = path.join(process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'), 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
const adb = process.env.OPENGYM_ADB || (existsSync(sdkAdb) ? sdkAdb : 'adb')
export async function runAdb(args) {
  const { stdout } = await exec(adb, args, { timeout: 15000, maxBuffer: 256 * 1024, windowsHide: true })
  return stdout.trim()
}
export async function discoverWatches(run = runAdb) {
  const output = await run(['devices', '-l'])
  const candidates = output.split(/\r?\n/).flatMap(line => {
    const match = /^(\S+)\s+device\s+(.*)$/.exec(line)
    return match ? [{ serial: match[1], model: /\bmodel:(\S+)/.exec(match[2])?.[1] || 'Wear OS' }] : []
  })
  const result = await Promise.all(candidates.map(async device => {
    try {
      const features = await run(['-s', device.serial, 'shell', 'pm', 'list', 'features'])
      return /^feature:android\.hardware\.type\.watch\s*$/m.test(features) ? device : null
    } catch { return null }
  }))
  return result.filter(Boolean)
}
export function chooseWatch(devices, serial) {
  if (!devices.length) throw Error('Nenhum relógio conectado. Ative a depuração sem fio e conecte o relógio ao ADB.')
  if (serial !== undefined) {
    const found = devices.find(device => device.serial === serial)
    if (!found) throw Error('Este relógio não está disponível.')
    return found
  }
  if (devices.length !== 1) throw Error('Selecione um relógio para conectar.')
  return devices[0]
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export class MotionBridge extends EventEmitter {
  status = { state: 'disconnected', message: 'Conecte o relógio para começar.' }
  hello = null
  socket = null
  port = null
  device = null
  operation = null
  failureCleanup = null
  shuttingDown = false
  watchdog = null
  constructor(run = runAdb) { super(); this.run = run }
  get busy() { return Boolean(this.operation || this.failureCleanup) }
  devices() { return discoverWatches(this.run) }
  setStatus(state, message) {
    this.status = { state, message, ...(this.device ? { device: this.device } : {}) }
    this.emit('status', this.status)
  }
  connect(serial) {
    if (this.busy || this.shuttingDown) return Promise.reject(Error('Aguarde a conexão atual terminar.'))
    this.operation = this.connectSession(serial).finally(() => { this.operation = null })
    return this.operation
  }
  async connectSession(serial) {
    try {
      await this.cleanup()
      this.setStatus('connecting', 'Localizando relógio…')
      this.device = chooseWatch(await this.devices(), serial)
      const launched = await this.run(['-s', this.device.serial, 'shell', 'am', 'start', '-W', '-n', activity])
      if (!/Status: ok/.test(launched)) throw Error('Instale o APK atualizado do relógio, com o visualizador de movimento.')
      const port = await this.run(['-s', this.device.serial, 'forward', 'tcp:0', 'localabstract:opengym-motion-v1'])
      if (!/^\d+$/.test(port) || +port < 1 || +port > 65535) throw Error('Não foi possível abrir o túnel do relógio.')
      this.port = +port
      this.socket = await this.openSocket()
      await this.receive(this.socket)
      return this.status
    } catch (error) {
      await this.cleanup()
      this.setStatus('error', error.message)
      throw error
    }
  }
  async openSocket() {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          const socket = net.createConnection({ host: '127.0.0.1', port: this.port })
          socket.setTimeout(1500)
          const fail = error => { socket.destroy(); reject(error) }
          socket.once('error', fail)
          socket.once('timeout', () => fail(Error('Tempo de conexão esgotado.')))
          socket.once('connect', () => { socket.removeListener('error', fail); socket.setTimeout(0); resolve(socket) })
        })
      } catch (error) { if (attempt === 7) throw error; await delay(150) }
    }
  }
  receive(socket) {
    const decoder = new MotionDecoder()
    socket.setEncoding('utf8')
    socket.setNoDelay(true)
    return new Promise((resolve, reject) => {
      let ready = false, ended = false, lastFrame = Date.now()
      const fail = error => {
        if (ended) return
        ended = true
        if (!ready) { reject(error); return }
        const pending = this.operation || Promise.resolve()
        this.failureCleanup = pending.catch(() => {}).then(() => this.cleanup()).finally(() => {
          this.failureCleanup = null
          this.setStatus('error', `Conexão interrompida: ${error.message} Reconecte o relógio.`)
        })
      }
      // Keep the handshake bounded, but allow an established wireless stream to recover.
      // The viewer freezes the pose after 1 s without fresh data during this grace period.
      this.watchdog = setInterval(() => {
        if (Date.now() - lastFrame > (ready ? 12000 : 5000)) fail(Error('O relógio não enviou dados.'))
      }, 1000)
      this.watchdog.unref()
      socket.on('data', chunk => {
        try {
          for (const packet of decoder.push(chunk)) {
            lastFrame = Date.now()
            if (packet.type === 'hello') {
              this.hello = packet; ready = true
              this.emit('hello', packet)
              this.setStatus('connected', 'Recebendo sensores do relógio.')
              resolve()
            } else this.emit('sample', { ...packet, receivedAt: Date.now() })
          }
        } catch (error) { fail(error) }
      })
      socket.on('error', fail)
      socket.on('close', () => fail(Error('O relógio encerrou a transmissão.')))
    })
  }
  async cleanup() {
    clearInterval(this.watchdog); this.watchdog = null
    if (this.socket) { this.socket.removeAllListeners(); this.socket.on('error', () => {}); this.socket.destroy(); this.socket = null }
    this.hello = null
    const port = this.port, device = this.device
    this.port = null; this.device = null
    if (port && device) await this.run(['-s', device.serial, 'forward', '--remove', `tcp:${port}`]).catch(() => {})
    if (device) await this.run(['-s', device.serial, 'shell', 'am', 'start', '-W', '--activity-single-top', '--activity-clear-top', '-n', activity, '-a', 'com.fredc.opengym.action.STOP_MOTION']).catch(() => {})
  }
  disconnect() {
    if (this.busy) return Promise.reject(Error('Aguarde a conexão atual terminar.'))
    this.operation = this.cleanup().then(() => {
      this.setStatus('disconnected', 'Desconectado. Sensores liberados.'); return this.status
    }).finally(() => { this.operation = null })
    return this.operation
  }
  async shutdown() {
    this.shuttingDown = true
    await this.operation?.catch(() => {})
    await this.failureCleanup?.catch(() => {})
    await this.cleanup()
  }
}

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']], ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']], ['/viewer.mjs', ['viewer.mjs', 'text/javascript; charset=utf-8']],
  ['/motion.mjs', ['motion.mjs', 'text/javascript; charset=utf-8']],
])
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)) }
async function body(req) {
  let text = ''
  for await (const chunk of req) { text += chunk; if (text.length > 1024) throw Error('Pedido muito grande.') }
  const value = JSON.parse(text || '{}')
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => key !== 'serial') || (value.serial !== undefined && (typeof value.serial !== 'string' || value.serial.length > 200))) throw Error('Pedido inválido.')
  return value
}
export function createMotionServer({ bridge = new MotionBridge(), idleDisconnectMs = 10000 } = {}) {
  const clients = new Set()
  let idleTimer
  const stopIfUnused = async () => {
    if (clients.size) return
    try { await bridge.disconnect() }
    catch { if (!clients.size) { idleTimer = setTimeout(stopIfUnused, Math.min(1000, idleDisconnectMs)); idleTimer.unref() } }
  }
  const send = (res, event, data) => {
    if (res.destroyed) return
    if (!res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) res.destroy()
  }
  for (const event of ['status', 'hello', 'sample']) bridge.on(event, data => { for (const res of clients) send(res, event, data) })
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'")
    const port = server.address()?.port
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
    const origin = req.headers.origin
    try {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname
      const publicAsset = req.method === 'GET' && assets.has(pathname)
      if (!allowed.has(req.headers.host) || (!publicAsset && ((origin && ![...allowed].some(host => origin === `http://${host}`)) || req.headers['sec-fetch-site'] === 'cross-site'))) return json(res, 403, { error: 'Acesso permitido somente pelo painel local.' })
      if (req.method === 'GET' && pathname === '/api/status') return json(res, 200, bridge.status)
      if (req.method === 'GET' && pathname === '/api/devices') return json(res, 200, { devices: await bridge.devices() })
      if (req.method === 'GET' && pathname === '/events') {
        if (clients.size >= 8) return json(res, 429, { error: 'Muitos painéis abertos.' })
        clearTimeout(idleTimer)
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
        res.write(': motion stream\n\n'); clients.add(res)
        if (bridge.hello) send(res, 'hello', bridge.hello)
        send(res, 'status', bridge.status)
        const keepalive = setInterval(() => { if (!res.destroyed && !res.write(': keepalive\n\n')) res.destroy() }, 15000)
        req.on('close', () => {
          clearInterval(keepalive); clients.delete(res)
          if (!clients.size) { idleTimer = setTimeout(stopIfUnused, idleDisconnectMs); idleTimer.unref() }
        })
        return
      }
      if (req.method === 'POST' && ['/api/connect', '/api/disconnect'].includes(pathname)) {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Use application/json.' })
        const value = await body(req)
        const result = pathname.endsWith('/connect') ? await bridge.connect(value.serial) : await bridge.disconnect()
        return json(res, 200, result)
      }
      if (req.method === 'GET' && assets.has(pathname)) {
        const [file, type] = assets.get(pathname)
        const content = await readFile(path.join(here, file))
        res.writeHead(200, { 'Content-Type': type }); return res.end(content)
      }
      return json(res, 404, { error: 'Não encontrado.' })
    } catch (error) { return json(res, 400, { error: error.message }) }
  })
  server.requestTimeout = 20000
  server.on('close', () => { clearTimeout(idleTimer); for (const res of clients) res.destroy() })
  return server
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.OPENGYM_MOTION_PORT || 5180)
  const bridge = new MotionBridge()
  const server = createMotionServer({ bridge })
  server.on('error', error => { console.error(error.message); process.exitCode = 1 })
  server.listen(port, '127.0.0.1', () => console.log(`OpenGym Movimento: http://127.0.0.1:${port}`))
  let shuttingDown = false
  const stop = async () => {
    if (shuttingDown) return
    shuttingDown = true
    await bridge.shutdown()
    server.closeAllConnections(); server.close(() => process.exit(0))
  }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
}
