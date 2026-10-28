/** Native entries remain durable until reply/replyHeart removes their exact key.
 * A failed/foreign entry cannot prevent other sessions from draining. */
export function createWearInbox({plugin,ready,command,heart}) {
  let running=null,disposed=false,again=false
  const host={
    run() {
      if(disposed || !ready() || !plugin.drainInbox) return Promise.resolve()
      if(running) return running
      running=Promise.resolve().then(async()=>{
        const owner=ready(), entries=[], seen=new Set();let afterKey=''
        do {
          const page=await plugin.drainInbox({afterKey})
          if(disposed || !owner || ready()!==owner) return
          for(const entry of page.entries||[]) if(!seen.has(entry.key)) {seen.add(entry.key);entries.push(entry)}
          const next=page.next || ''
          if(next && next<=afterKey || entries.length>512) throw new Error('invalid-inbox')
          afterKey=next
        } while(afterKey)
        entries.sort((a,b)=>(a.kind==='command'?0:1)-(b.kind==='command'?0:1))
        for(const entry of entries) {
          if(disposed || ready()!==owner) return
          try { if(entry.kind==='command') await command(entry);else if(entry.kind==='heart') await heart(entry) } catch { /* no successful reply: retain */ }
        }
      }).finally(()=>{running=null;if(again) {again=false;void host.run().catch(()=>{})}})
      return running
    },
    wake() {if(running) again=true;return host.run()},
    dispose() {disposed=true},
  }
  return host
}
