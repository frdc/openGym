/** Only snapshots are replaceable. Journal actions and heart packets never enter
 * this mailbox. One native publication runs at a time; stale pulls release CPU. */
export function createWearPublisher({send,dropped=()=>{},maxPending=8}) {
  const pending=new Map();let pumping=false,active=null,disposed=false,sent=0,failed=0,skipped=0
  const drop=job=>{
    skipped++;job.resolve()
    if(job.request) {try {Promise.resolve(dropped(job.request)).catch(()=>{})} catch { /* best effort lock release */ }}
  }
  function pump() {
    if(pumping || disposed) return
    pumping=true
    void Promise.resolve().then(async()=>{
      while(!disposed && pending.size) {
        const key=pending.has('manual')?'manual':[...pending.keys()].find(k=>k!=='state') || 'state'
        const job=pending.get(key);pending.delete(key);active=job
        try {await send(job.request);sent++;job.resolve()} catch(error) {failed++;job.reject(error)}
        active=null
      }
    }).finally(()=>{pumping=false;if(pending.size && !disposed) pump()})
  }
  return {
    publish(request=null,key='state') {
      if(disposed) return Promise.resolve()
      const previous=pending.get(key)
      if(previous && (key==='state' || previous.request?.syncId===request?.syncId)) return previous.promise
      if(previous) {pending.delete(key);drop(previous)}
      let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no})
      pending.set(key,{request,promise,resolve,reject})
      while(pending.size>maxPending) {
        const stale=[...pending.keys()].find(k=>k!=='manual' && k!=='state')
        if(!stale) break
        const job=pending.get(stale);pending.delete(stale);drop(job)
      }
      pump();return promise
    },
    stats() {return {inFlight:active?1:0,pending:pending.size,sent,failed,skipped}},
    dispose() {disposed=true;for(const job of pending.values()) drop(job);pending.clear();if(active) drop(active)},
  }
}
