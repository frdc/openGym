import {expect,it,vi} from 'vitest'
import {createWearPublisher} from './wear-publisher.js'
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))

it('keeps only the newest state job behind a blocked publication',async()=>{
  let release;const send=vi.fn().mockImplementationOnce(()=>new Promise(r=>{release=r})).mockResolvedValue()
  const host=createWearPublisher({send}),first=host.publish()
  await tick();const updates=Array.from({length:100},()=>host.publish())
  expect(new Set(updates).size).toBe(1);expect(host.stats().pending).toBe(1)
  release();await Promise.all([first,...updates]);expect(send).toHaveBeenCalledTimes(2)
})
it('keeps manual correlation separate from the newest pull for a node',async()=>{
  let release;const sent=[],dropped=[]
  const host=createWearPublisher({send:async request=>{sent.push(request?.syncId||'state');if(sent.length===1) await new Promise(r=>{release=r})},dropped:r=>dropped.push(r.syncId)})
  const first=host.publish();await tick()
  const jobs=['a','b','c'].map(syncId=>host.publish({nodeId:'watch',syncId},'pull:watch'))
  jobs.push(host.publish({nodeId:'watch',syncId:'manual'},'manual'))
  release();await Promise.all([first,...jobs]);expect(sent).toEqual(['state','manual','c']);expect(dropped).toEqual(['a','b'])
})
it('continues after failure and releases pending callers when disposed',async()=>{
  const send=vi.fn().mockRejectedValueOnce(new Error('native-failed')).mockResolvedValue()
  const host=createWearPublisher({send});await expect(host.publish()).rejects.toThrow('native-failed')
  await host.publish();expect(host.stats().failed).toBe(1)
  host.dispose();await host.publish();expect(send).toHaveBeenCalledTimes(2)
})
it('bounds stale node pulls without touching action or heart queues',async()=>{
  let release;const send=vi.fn().mockImplementationOnce(()=>new Promise(r=>{release=r})).mockResolvedValue(),dropped=vi.fn()
  const host=createWearPublisher({send,dropped,maxPending:4}),first=host.publish();await tick()
  const jobs=Array.from({length:40},(_,i)=>host.publish({nodeId:`watch-${i}`,syncId:`request-${i}`},`pull:watch-${i}`))
  expect(host.stats().pending).toBeLessThanOrEqual(4);expect(dropped.mock.calls.length).toBeGreaterThan(30)
  host.dispose();release();await Promise.all([first,...jobs]);expect(send).toHaveBeenCalledTimes(1)
})
