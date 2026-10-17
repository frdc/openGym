export const defaults = {
  version: 1,
  theme: { primary: '#d3b1ff', ink: '#f7efff', muted: '#c9b7e0', surface: '#2a154b', surfaceOpacity: .63, outline: '#6a39b3', heart: '#ff3b4f' },
  button: { x:112.5, width: 124, height: 36, bottom: 4, font: 16, icon: 20, gap: 8, corner: 8, bowl: .22 },
  sample: { name: 'Supino Reto', series: 'Série 2/4', reps: '10', load: '40', unit: 'kg', timer: '00:00', rest: '01:30' },
  screens: {
    workout: [
      { id: 'title', label: 'Nome do exercício', kind: 'arc', x:112.5, y:21, font:18, radius:101.25, weight:700 },
      { id: 'series', label:'Série', kind:'text', x:112.5, y:62, font:12, weight:600, muted:true },
      { id: 'timer', label:'Tempo', kind:'text', x:120.5, y:105, font:40, weight:700 },
      { id: 'heart', label:'Ícone de batimentos', kind:'heart', x:24, y:105, width:12, height:12 },
      { id: 'reps', label:'Repetições', kind:'metric', x:71.75, y:150, width:79.5, height:32, font:16, unitFont:12, corner:20 },
      { id: 'load', label:'Carga', kind:'metric', x:153.25, y:150, width:79.5, height:32, font:16, unitFont:12, corner:20 },
      { id: 'dots', label:'Indicador de páginas', kind:'dots', x:112.5, y:173, width:20, height:8, radius:2 },
      { id:'primary', label:'Botão Iniciar', kind:'primary' }
    ],
    rest: [
      { id:'title', label:'Nome do exercício', kind:'arc', x:112.5,y:21,font:18,radius:101.25,weight:700 },
      { id:'series',label:'Série',kind:'text',x:112.5,y:62,font:12,weight:600,muted:true },
      { id:'timer',label:'Tempo de descanso',kind:'text',x:120.5,y:95,font:40,weight:700 },
      { id:'heart',label:'Ícone de batimentos',kind:'heart',x:24,y:101,width:12,height:12 },
      { id:'summary',label:'Repetições × carga',kind:'text',x:112.5,y:118,font:12,weight:500 },
      { id:'plus',label:'Adicionar 15 segundos',kind:'pill',text:'+15 s',x:71.75,y:150,width:79.5,height:40,font:16,corner:24 },
      { id:'skip',label:'Pular descanso',kind:'pill',text:'Pular',x:153.25,y:150,width:79.5,height:40,font:16,corner:24 },
      { id:'dots',label:'Indicador de páginas',kind:'dots',x:112.5,y:173,width:20,height:8,radius:2 },
      { id:'primary',label:'Botão Pausar',kind:'primary' }
    ],
    options: [
      { id:'heading',label:'Título da tela',kind:'text',text:'Opções',x:112.5,y:28,font:20,weight:700 },
      { id:'heart-option',label:'Batimentos',kind:'option',text:'Batimentos',icon:'heart',x:112.5,y:76.5,width:165,height:42,font:14,corner:24 },
      { id:'alerts',label:'Alertas',kind:'option',text:'Alertas',icon:'bell',x:112.5,y:125.5,width:165,height:42,font:14,corner:24 },
      { id:'reconnect',label:'Reconectar',kind:'option',text:'Reconectar',icon:'refresh',x:112.5,y:174.5,width:165,height:42,font:14,corner:24 },
      { id:'dots',label:'Indicador de páginas',kind:'dots',x:112.5,y:215,width:20,height:8,radius:2 }
    ],
    load: [
      { id:'back',label:'Voltar',kind:'back',x:54,y:36,width:18,height:18 },
      { id:'heading',label:'Título da tela',kind:'text',text:'Carga',x:112.5,y:36,font:16,weight:600 },
      { id:'exercise',label:'Nome do exercício',kind:'text',x:112.5,y:68,font:12,weight:500 },
      { id:'minus',label:'Diminuir carga',kind:'adjust',text:'−',x:54,y:100,width:48,height:48,font:28 },
      { id:'value',label:'Valor da carga',kind:'text',x:112.5,y:100,font:28,weight:700 },
      { id:'plus',label:'Aumentar carga',kind:'adjust',text:'+',x:171,y:100,width:48,height:48,font:28 },
      { id:'cancel',label:'Botão Cancelar',kind:'pill',text:'Cancelar',x:112.5,y:148,width:100,height:32,font:14,corner:20 },
      { id:'primary',label:'Botão Confirmar',kind:'primary' }
    ]
  }
}

export function validateLayout(value) {
  if (!value || value.version !== 1 || !value.theme || !value.button || !value.sample || !value.screens) throw new Error('Este arquivo não é um layout válido do OpenGym.')
  const result = structuredClone(defaults)
  for (const [key, base] of Object.entries(defaults.theme)) {
    const v = value.theme[key]
    if (typeof base === 'string' && !/^#[0-9a-f]{6}$/i.test(v)) throw new Error('Cor inválida: ' + key)
    if (typeof base === 'number' && (!Number.isFinite(v) || v < 0 || v > 1)) throw new Error('Opacidade inválida.')
    result.theme[key] = v
  }
  for (const key of Object.keys(defaults.button)) {
    const v = value.button[key]
    if (!Number.isFinite(v) || v < 0 || v > 225) throw new Error('Medida inválida no botão: ' + key)
    result.button[key] = v
  }
  if (result.button.width < 48 || result.button.height < 20 || result.button.font < 8) throw new Error('O botão principal está pequeno demais.')
  for (const key of Object.keys(defaults.sample)) {
    if (typeof value.sample[key] !== 'string' || value.sample[key].length > 120) throw new Error('Conteúdo de exemplo inválido.')
    result.sample[key] = value.sample[key]
  }
  for (const [screen, elements] of Object.entries(defaults.screens)) {
    if (!Array.isArray(value.screens[screen]) || value.screens[screen].length !== elements.length) throw new Error('Lista de elementos inválida: ' + screen)
    result.screens[screen] = elements.map(base => {
      const item = value.screens[screen].find(x => x.id === base.id)
      if (!item || item.kind !== base.kind) throw new Error('Elemento inválido: ' + base.id)
      const merged = { ...base }
      for (const [key, v] of Object.entries(item)) {
        if (!(key in base)) continue
        if (typeof base[key] === 'number') {
          if (!Number.isFinite(v) || v < 0 || v > (key === 'weight' ? 900 : 300)) throw new Error('Medida inválida: ' + base.id)
          merged[key] = v
        } else if (typeof base[key] === 'string' && typeof v === 'string' && v.length <= 120 && !['id','kind','label'].includes(key)) merged[key] = v
        else if (typeof base[key] === 'boolean' && typeof v === 'boolean') merged[key] = v
      }
      if (item.hidden !== undefined) merged.hidden = !!item.hidden
      return merged
    })
  }
  return result
}
