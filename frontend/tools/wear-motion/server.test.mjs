import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import net from 'node:net'
import { once } from 'node:events'
import { createMotionServer, discoverWatches, chooseWatch, MotionBridge } from './server.mjs'

test('discovers only authorized wearable devices, ignoring offline and phones', async () => {
  const run = async args => {
    if (args[0] === 'devices') return 'List of devices attached\nwatch:123 device model:SM_L705F\nphone device model:SM_S918B\ntv offline model:TV\nunknown unauthorized\n'
    if (args.includes('features')) return args[1] === 'watch:123' ? 'feature:android.hardware.type.watch\n' : 'feature:android.hardware.telephony\n'
    throw Error('Unexpected command')
  }
  assert.deepEqual(await discoverWatches(run), [{ serial: 'watch:123', model: 'SM_L705F' }])
})
test('selection never guesses among multiple watches or accepts arbitrary serials', () => {
  const devices = [{ serial: 'one', model: 'Watch' }, { serial: 'two', model: 'Watch2' }]
  assert.throws(() => chooseWatch(devices), /Selecione/)
  assert.throws(() => chooseWatch(devices, 'other'), /disponível/)
  assert.equal(chooseWatch(devices, 'two').serial, 'two')
  assert.throws(() => chooseWatch([]), /relógio/)
})

test('shutdown waits for an in-flight forward and removes the tunnel it creates', async () => {
  let releaseForward, reachedForward
  const reached = new Promise(resolve => { reachedForward = resolve })
  const forwarding = new Promise(resolve => { releaseForward = resolve })
  const calls = []
  const run = async args => {
    calls.push(args)
    if (args[0] === 'devices') return 'watch device model:Watch'
    if (args.includes('features')) return 'feature:android.hardware.type.watch'
    if (args.includes('tcp:0')) { reachedForward(); return forwarding }
    return 'Status: ok'
  }
  const bridge = new MotionBridge(run)
  bridge.openSocket = async () => { throw Error('No sensor service') }
  const connecting = assert.rejects(bridge.connect(), /No sensor service/)
  await reached
  const shuttingDown = bridge.shutdown()
  releaseForward('54321')
  await connecting; await shuttingDown
  assert.ok(calls.some(args => args[1] === 'watch' && args.includes('--remove') && args.includes('tcp:54321')))
  assert.equal(bridge.port, null)
  await assert.rejects(bridge.connect(), /Aguarde/)
})
class FakeBridge extends EventEmitter {
  status = { state: 'disconnected', message: 'Desconectado' }
  async devices() { return [{ serial: 'one', model: 'Watch' }] }
  async connect(serial) { this.selected = serial; this.status = { state: 'connected', message: 'Ao vivo' }; return this.status }
  async disconnect() { this.status = { state: 'disconnected', message: 'Desconectado' }; return this.status }
}
test('closing the last panel retries shutdown if an ADB connection is still busy', async t => {
  const bridge = new FakeBridge()
  let attempts = 0
  bridge.disconnect = async () => {
    attempts++
    if (attempts === 1) throw Error('Ainda conectando')
    bridge.emit('stopped')
    return bridge.status
  }
  const server = createMotionServer({ bridge, idleDisconnectMs: 20 })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const stopped = once(bridge, 'stopped')
  const request = http.get(`http://127.0.0.1:${server.address().port}/events`)
  const [response] = await once(request, 'response')
  response.resume(); response.destroy(); request.destroy()
  await stopped
  assert.equal(attempts, 2)
})
test('loopback HTTP serves viewer and denies cross-origin device control', async t => {
  const bridge = new FakeBridge()
  const server = createMotionServer({ bridge })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const url = `http://127.0.0.1:${server.address().port}`
  assert.equal((await fetch(url + '/api/status')).status, 200)
  assert.equal((await fetch(url + '/api/devices')).status, 200)
  assert.equal((await fetch(url + '/', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 200)
  assert.equal((await fetch(url + '/api/devices', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
  const cross = await fetch(url + '/api/connect', { method: 'POST', headers: { Origin: 'https://unrelated.example', 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(cross.status, 403)
  assert.equal(bridge.selected, undefined)
  const badType = await fetch(url + '/api/connect', { method: 'POST', body: '{}' })
  assert.equal(badType.status, 415)
  const valid = await fetch(url + '/api/connect', { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: '{"serial":"one"}' })
  assert.equal(valid.status, 200)
  assert.equal(bridge.selected, 'one')
  assert.equal((await fetch(url + '/server.mjs')).status, 404)
  const hostileHost = await new Promise(resolve => {
    http.get(url + '/api/status', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode) })
  })
  assert.equal(hostileHost, 403)
})

test('real socket forwards sensor frames and removes only its own tunnel on disconnect', async t => {
  const hello = { v: 1, type: 'hello', session: 'fixture', model: 'Test Watch', orientation: 'rotation_vector', sensors: { orientation: true, accel: true, gyro: false, linear: false }, rateHz: 25 }
  const packet = { v: 1, type: 'sample', session: 'fixture', seq: 1, tMs: 42, q: [0, 0, 0, 1], accel: [0, 0, 9.8], gyro: null, linear: null, accuracy: 3, orientationAgeMs: 0 }
  let peer
  const sensorServer = net.createServer(socket => { peer = socket; socket.write(JSON.stringify(hello) + '\n') })
  await new Promise(resolve => sensorServer.listen(0, '127.0.0.1', resolve))
  const port = sensorServer.address().port
  const calls = []
  const run = async args => {
    calls.push(args)
    if (args[0] === 'devices') return 'watch device model:Test_Watch'
    if (args.includes('features')) return 'feature:android.hardware.type.watch'
    if (args.includes('tcp:0')) return String(port)
    return 'Status: ok'
  }
  const bridge = new MotionBridge(run)
  t.after(async () => { await bridge.cleanup(); peer?.destroy(); await new Promise(resolve => sensorServer.close(resolve)) })
  await bridge.connect()
  assert.equal(bridge.status.state, 'connected')
  const nextSample = once(bridge, 'sample')
  const line = JSON.stringify(packet) + '\n'; peer.write(line.slice(0, 20)); peer.write(line.slice(20))
  const [received] = await nextSample
  assert.deepEqual(received.q, [0, 0, 0, 1]); assert.equal(received.gyro, null)
  assert.ok(received.receivedAt > 0)
  await bridge.disconnect()
  assert.equal(bridge.status.state, 'disconnected')
  assert.ok(calls.some(args => args.includes('--remove') && args.includes(`tcp:${port}`)))
  assert.ok(calls.some(args => args.includes('com.fredc.opengym.action.STOP_MOTION')))
  assert.equal(calls.some(args => args.includes('force-stop') || args.includes('--remove-all')), false)
})

test('a closed stream becomes an error and frees the session before reconnecting', async t => {
  const hello = { v: 1, type: 'hello', session: 'fixture', model: 'Test Watch', orientation: 'unavailable', sensors: { orientation: false, accel: false, gyro: false, linear: false }, rateHz: 25 }
  let peer
  const sensorServer = net.createServer(socket => { peer = socket; socket.write(JSON.stringify(hello) + '\n') })
  await new Promise(resolve => sensorServer.listen(0, '127.0.0.1', resolve))
  const run = async args => args[0] === 'devices' ? 'watch device model:Watch' : args.includes('features') ? 'feature:android.hardware.type.watch' : args.includes('tcp:0') ? String(sensorServer.address().port) : 'Status: ok'
  const bridge = new MotionBridge(run)
  t.after(async () => { await bridge.cleanup(); peer?.destroy(); await new Promise(resolve => sensorServer.close(resolve)) })
  await bridge.connect()
  const failed = once(bridge, 'status')
  peer.destroy()
  assert.equal((await failed)[0].state, 'error')
  assert.equal(bridge.port, null); assert.equal(bridge.hello, null); assert.equal(bridge.busy, false)
  await bridge.connect()
  assert.equal(bridge.status.state, 'connected')
})
