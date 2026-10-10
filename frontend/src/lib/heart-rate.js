const finite = n => typeof n === 'number' && Number.isFinite(n)
const summary = points => points.length ? { count: points.length, mean: Math.round(points.reduce((n,p)=>n+p[1],0)/points.length*10)/10, peak: Math.max(...points.map(p=>p[1])) } : null
export function heartRateEndReading(measurement) {
  if (!finite(measurement?.effortEndMs)) return null
  return (measurement.points || []).filter(p=>Math.abs(p[0]-measurement.effortEndMs)<=5000).sort((a,b)=>Math.abs(a[0]-measurement.effortEndMs)-Math.abs(b[0]-measurement.effortEndMs)||a[0]-b[0])[0] || null
}
export function buildHeartRate(input = {}) {
  if (!finite(input.startedAt) || input.startedAt <= 0) throw new Error('invalid-heart-measurement')
  const effortEndMs = finite(input.effortEndMs) && input.effortEndMs >= 0 ? input.effortEndMs : null
  const recoveryEndMs = finite(input.recoveryEndMs) && effortEndMs !== null && input.recoveryEndMs >= effortEndMs ? input.recoveryEndMs : null
  const points = [...new Map((input.points || []).filter(p=>Array.isArray(p) && p.length===2 && finite(p[0]) && p[0]>=0 && p[0]<=86400000 && finite(p[1]) && p[1]>=25 && p[1]<=250 && (recoveryEndMs===null || p[0]<=recoveryEndMs)).map(p=>[p[0],[...p]])).values()].sort((a,b)=>a[0]-b[0])
  const effortPoints = points.filter(p=>effortEndMs===null || p[0]<=effortEndMs), recoveryPoints = points.filter(p=>effortEndMs!==null && p[0]>effortEndMs)
  const nearest = at => points.filter(p=>Math.abs(p[0]-at)<=5000).sort((a,b)=>Math.abs(a[0]-at)-Math.abs(b[0]-at)||a[0]-b[0])[0]
  const end = effortEndMs===null ? null : nearest(effortEndMs)
  let milestones = end ? [30,60,120].flatMap(seconds=>{
    const at = effortEndMs+seconds*1000
    if (recoveryEndMs!==null && at>recoveryEndMs) return []
    const p = recoveryPoints.filter(p=>Math.abs(p[0]-at)<=5000).sort((a,b)=>Math.abs(a[0]-at)-Math.abs(b[0]-at)||a[0]-b[0])[0]
    return p ? [{seconds,atMs:p[0],bpm:p[1],delta:end[1]-p[1]}] : []
  }) : []
  let plotted = points
  if (points.length>300) {
    const indices = new Set([0,points.length-1])
    if(end) indices.add(points.indexOf(end))
    for(const milestone of milestones) { const i=points.findIndex(p=>p[0]===milestone.atMs && p[1]===milestone.bpm);if(i>=0) indices.add(i) }
    for (const phase of [effortPoints,recoveryPoints]) if (phase.length) {
      for (const p of [phase[0],phase.at(-1),phase.reduce((a,b)=>a[1]<b[1]?a:b),phase.reduce((a,b)=>a[1]>b[1]?a:b)]) indices.add(points.indexOf(p))
    }
    for (let i=0;indices.size<300 && i<300;i++) indices.add(Math.round(i*(points.length-1)/299))
    plotted = [...indices].sort((a,b)=>a-b).slice(0,300).map(i=>points[i])
  }
  const phases = { effort: summary(effortPoints), recovery: summary(recoveryPoints) }
  for (const phase of ['effort','recovery']) if (input[phase]!=null) {
    const s=input[phase], computed=phases[phase]
    if (!Number.isInteger(s.count)||s.count<1||s.count>100000||!finite(s.mean)||!finite(s.peak)||s.mean<25||s.mean>250||s.peak<s.mean||s.peak>250||s.count<(computed?.count||0)||s.peak<(computed?.peak||0)) throw new Error('invalid-heart-summary')
    if(computed && (s.peak!==computed.peak || s.count===computed.count && Math.abs(s.mean-computed.mean)>0.11)) throw new Error('invalid-heart-summary')
    phases[phase]={count:s.count,mean:s.mean,peak:s.peak}
  }
  if (Array.isArray(input.milestones)) milestones = input.milestones.filter(m=>milestones.some(real=>real.seconds===m?.seconds&&real.atMs===m.atMs&&real.bpm===m.bpm&&real.delta===m.delta)).map(m=>({seconds:m.seconds,atMs:m.atMs,bpm:m.bpm,delta:m.delta})).filter((m,i,a)=>a.findIndex(x=>x.seconds===m.seconds)===i)
  return {v:1,source:'galaxy-watch',startedAt:input.startedAt,effortEndMs,recoveryEndMs,endReason:typeof input.endReason==='string'?input.endReason.slice(0,80):null,status:!points.length?(recoveryEndMs===null?'pending':'empty'):input.partial?'partial':recoveryEndMs===null?'pending':!effortPoints.length||!recoveryPoints.length?'partial':'complete',points:plotted,...phases,milestones}
}
