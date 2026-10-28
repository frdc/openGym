import { expect,it,vi } from 'vitest'
import { createWearInbox } from './wear-inbox.js'

it('drains commands before heart data, retains failed and foreign entries, and coalesces wakeups',async()=>{
  const entries=[{key:'a',kind:'heart',nodeId:'watch',payload:{token:'heart'}},{key:'b',kind:'command',nodeId:'watch',payload:{contextToken:'ours'}},{key:'c',kind:'command',nodeId:'watch',payload:{contextToken:'other'}}]
  const plugin={drainInbox:vi.fn(async()=>({entries:structuredClone(entries),next:''}))}, order=[]
  let ready=false
  const drain=createWearInbox({plugin,ready:()=>ready,command:async e=>{order.push(e.payload.contextToken)},heart:async()=>{order.push('heart');throw new Error('pending')}})
  await drain.run();expect(plugin.drainInbox).not.toHaveBeenCalled()
  ready=true
  await Promise.all([drain.run(),drain.run(),drain.run()])
  expect(order).toEqual(['ours','other','heart'])
  expect(entries).toHaveLength(3) // Only native success replies can retire exact items.
  drain.dispose();await drain.run();expect(order).toHaveLength(3)
})
it('reads all bounded pages before processing and stops on owner change',async()=>{
  let owner='a';const seen=[]
  const plugin={drainInbox:vi.fn(async({afterKey})=>afterKey?{entries:[{key:'b',kind:'heart'}],next:''}:{entries:[{key:'a',kind:'command'}],next:'a'})}
  const host=createWearInbox({plugin,ready:()=>owner,command:async()=>{seen.push('command');owner='b'},heart:async()=>seen.push('heart')})
  await host.run();expect(seen).toEqual(['command']);expect(plugin.drainInbox).toHaveBeenCalledTimes(2)
})
it('rechecks entries arriving after the current page was read',async()=>{
  let rows=[{key:'a',kind:'command'}],release;const seen=[]
  const plugin={drainInbox:async()=>({entries:structuredClone(rows),next:''})}
  const host=createWearInbox({plugin,ready:()=>true,command:async e=>{seen.push(e.key);rows=rows.filter(r=>r.key!==e.key);if(e.key==='a') await new Promise(r=>{release=r})},heart:async()=>{}})
  const pending=host.run();await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
  rows.push({key:'b',kind:'command'});host.wake();release();await pending
  await vi.waitFor(()=>expect(seen).toEqual(['a','b']))
})
