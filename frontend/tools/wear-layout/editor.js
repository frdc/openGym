import { defaults, validateLayout } from './model.js'

const $ = id => document.getElementById(id)
const clone = value => structuredClone(value)
const storageKey = 'opengym-wear-layout-editor-v1'
let config = clone(defaults), screen = 'workout', selected = 'primary', undo = [], dragging = null
let loaded = false, phase = 0, lastFrame = 0, needsDraw = true, saveTimer
const ctx = $('layout').getContext('2d'), overlay = $('selection').getContext('2d')
const buttonControls = $('button-controls'), buttonHost = buttonControls.parentElement
const background = new Image()
background.src = new URL('../../android/wear/src/main/res/drawable-nodpi/wear_violet_aurora.png', import.meta.url).href
background.onload = () => { loaded = true; setupBackground(); needsDraw = true }
try { const saved = localStorage.getItem(storageKey); if (saved) config = validateLayout(JSON.parse(saved)) } catch { status('Não foi possível recuperar os ajustes anteriores. A prévia abriu com o layout original.') }
const names = { workout:'Treino', rest:'Descanso', options:'Opções', load:'Carga' }
const elements = () => config.screens[screen]
const element = () => elements().find(e => e.id === selected)
const buttonLabel = () => screen === 'rest' ? 'Pausar' : screen === 'load' ? 'Confirmar' : 'Iniciar'
function status(message) { $('status').textContent = message }
function remember() { undo.push(clone(config)); if (undo.length > 60) undo.shift(); $('undo').disabled = false }
function changed() {
  needsDraw = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { try { localStorage.setItem(storageKey,JSON.stringify(config)); status('Ajustes salvos neste navegador.') } catch { status('O navegador não permitiu salvar. Use “Exportar ajustes” para guardar o layout.') } },200)
}
function node(tag, props = {}, parent) { const el=document.createElement(tag); Object.assign(el,props); if(parent) parent.append(el); return el }
function range(parent, label, target, key, min, max, step=1) {
  const row=node('div',{className:'field'},parent), text=node('label',{textContent:label},row)
  const slider=node('input',{type:'range',min,max,step,value:target[key],ariaLabel:label},row)
  const number=node('input',{type:'number',min,max,step,value:target[key],ariaLabel:label+' (valor)'},row)
  text.htmlFor = slider.id = parent.id+'-'+key+'-'+label.replace(/\W/g,'')
  let editing=false
  for(const input of [slider,number]) {
    input.addEventListener('focus',()=> { editing=false })
    input.addEventListener('pointerdown',()=> { editing=false })
    input.addEventListener('input',()=> {
      if(input.value.trim()==='') return
      const value=Number(input.value); if(!Number.isFinite(value)) return
      if(!editing) { remember(); editing=true }
      target[key]=Math.max(min,Math.min(max,value)); slider.value=number.value=target[key]; changed()
    })
  }
}
function textField(parent,label,target,key) {
  const wrapper=node('label',{textContent:label},parent), input=node('input',{type:'text',value:target[key],maxLength:120},wrapper)
  let editing=false
  input.onfocus=()=> { editing=false }
  input.oninput=()=> { if(!editing) {remember();editing=true} target[key]=input.value;changed() }
}
function controls() {
  buttonHost.append(buttonControls)
  $('element').replaceChildren()
  for(const e of elements()) node('option',{value:e.id,textContent:e.label},$('element'))
  $('element').value=selected
  $('controls').replaceChildren()
  const e=element(); if(!e) return
  $('primary-heading').style.display=e.kind==='primary'?'none':'flex'
  if(e.kind==='primary') {
    node('p',{className:'small',textContent:'As mudanças de estilo valem para Iniciar, Pausar e Confirmar.'},$('controls'))
    $('controls').append(buttonControls)
  }
  else {
    range($('controls'),'Posição horizontal',e,'x',0,225,.5)
    range($('controls'),'Posição vertical',e,'y',0,225,.5)
    if('font' in e) range($('controls'),'Tamanho da fonte',e,'font',8,60,.5)
    if('weight' in e) range($('controls'),'Peso da fonte',e,'weight',300,900,50)
    if('width' in e) range($('controls'),'Largura',e,'width',8,220,.5)
    if('height' in e) range($('controls'),'Altura',e,'height',4,100,.5)
    if('unitFont' in e) range($('controls'),'Fonte da unidade',e,'unitFont',8,24,.5)
    if('corner' in e) range($('controls'),'Cantos arredondados',e,'corner',0,40,.5)
    if('radius' in e) range($('controls'),e.kind==='arc' ? 'Raio do arco' : 'Tamanho dos pontos',e,'radius',e.kind==='arc' ? 65 : 1,e.kind==='arc' ? 160 : 5,.5)
    if('text' in e) textField($('controls'),'Texto',e,'text')
  }
  const label=node('label',{className:'check'},$('controls')), visible=node('input',{type:'checkbox',checked:!e.hidden},label)
  label.append(document.createTextNode('Mostrar elemento'))
  visible.onchange=()=> { remember();e.hidden=!visible.checked;changed() }
}
function sharedControls() {
  $('theme').replaceChildren(); $('button-controls').replaceChildren(); $('sample-controls').replaceChildren()
  for(const [key,label] of Object.entries({primary:'Botão principal',ink:'Texto principal',muted:'Texto secundário',surface:'Fundo dos controles',outline:'Contorno dos controles',heart:'Coração'})) {
    const row=node('div',{className:'color-field'},$('theme')); node('label',{textContent:label,htmlFor:'color-'+key},row)
    const input=node('input',{type:'color',id:'color-'+key,value:config.theme[key]},row)
    input.onchange=()=> {remember();config.theme[key]=input.value;changed()}
  }
  range($('theme'),'Opacidade dos controles',config.theme,'surfaceOpacity',0,1,.01)
  for(const [key,label,min,max,step] of [ ['x','Posição horizontal',48,177,.5],['width','Largura',48,190,.5],['height','Altura visível',20,65,.5],['bottom','Distância da borda inferior',0,50,.5],['font','Tamanho da fonte',8,28,.5],['icon','Tamanho do ícone',8,36,.5],['gap','Espaço entre ícone e texto',0,24,.5],['corner','Cantos superiores',0,20,.5],['bowl','Curva inferior',.1,.6,.01] ]) range($('button-controls'),label,config.button,key,min,max,step)
  for(const [key,label] of Object.entries({name:'Exercício',series:'Série',timer:'Tempo do treino',rest:'Tempo de descanso',reps:'Repetições',load:'Carga',unit:'Unidade'})) textField($('sample-controls'),label,config.sample,key)
}
function select(id) { selected=id;controls();needsDraw=true }
for(const [key,label] of Object.entries(names)) {
  const b=node('button',{textContent:label},$('screens'))
  b.onclick=()=> {screen=key;selected=elements().some(e=>e.id==='primary') ? 'primary' : 'heading';refresh()}
  b.dataset.screen=key
}
function refresh() {
  for(const b of $('screens').children) { const active=b.dataset.screen===screen;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active)) }
  controls();sharedControls();$('undo').disabled=!undo.length;needsDraw=true
}
function font(size,weight=600) { ctx.font=`${weight} ${size}px Nunito, sans-serif` }
function content(e) {
  if(e.text !== undefined) return e.text
  const s=config.sample
  return ({title:s.name,series:s.series,timer:screen==='rest'?s.rest:s.timer,exercise:s.name,value:s.load+' '+s.unit,summary:s.reps+' reps × '+s.load+' '+s.unit})[e.id] || ''
}
function bounds(e) {
  if(e.kind==='primary') { const b=config.button; return {x:b.x-b.width/2,y:225-b.bottom-b.height,w:b.width,h:b.height} }
  if(e.kind==='arc') return {x:e.x-105,y:e.y+3,w:210,h:39}
  if(e.width) return {x:e.x-e.width/2,y:e.y-e.height/2,w:e.width,h:e.height}
  font(e.font,e.weight); return {x:e.x-ctx.measureText(content(e)).width/2,y:e.y-e.font*.6,w:Math.max(24,ctx.measureText(content(e)).width),h:e.font*1.2}
}
function pill(e,primary=false) {
  const b=bounds(e);ctx.beginPath();ctx.roundRect(b.x,b.y,b.w,b.h,e.corner || b.h/2)
  ctx.fillStyle=primary?config.theme.primary:config.theme.surface;ctx.globalAlpha=primary?1:config.theme.surfaceOpacity;ctx.fill();ctx.globalAlpha=1
  if(!primary){ctx.strokeStyle=config.theme.outline;ctx.lineWidth=.5;ctx.globalAlpha=.47;ctx.stroke();ctx.globalAlpha=1}
}
function icon(kind,x,y,size,color) {
  ctx.save();ctx.translate(x-size/2,y-size/2);ctx.scale(size/24,size/24);ctx.fillStyle=ctx.strokeStyle=color;ctx.lineWidth=2;ctx.lineCap='round';ctx.lineJoin='round'
  const paths={play:'M7 4 L20 12 L7 20 Z',pause:'M6 4 H10 V20 H6 Z M14 4 H18 V20 H14 Z',check:'M4 12 L9 17 L20 6',back:'M14 5 L7 12 L14 19 M7 12 H21',heart:'M12 20 C9 17 3 13 3 8 C3 3 9 2 12 7 C15 2 21 3 21 8 C21 13 15 17 12 20 Z',bell:'M5 17 H19 L17 14 V9 C17 2 7 2 7 9 V14 Z M10 21 H14',refresh:'M20 8 C17 0 5 1 3 10 M20 3 V8 H15 M4 16 C7 24 19 23 21 14 M4 21 V16 H9',chevron:'M9 5 L16 12 L9 19'}
  const path=new Path2D(paths[kind] || paths.check)
  if(['play','pause','heart'].includes(kind))ctx.fill(path);else ctx.stroke(path);ctx.restore()
}
function drawElement(e) {
  if(e.hidden)return
  const t=config.theme;ctx.fillStyle=e.muted?t.muted:t.ink;ctx.textAlign='center';ctx.textBaseline='middle'
  if(e.kind==='arc') {
    font(e.font,e.weight);let value=content(e).replace(/\n/g,' ');const length=e.radius*Math.PI*64/180
    while(ctx.measureText(value).width>length-4 && value.length>1) value=value.slice(0,-2)+'…'
    const width=ctx.measureText(value).width;let advance=-width/2
    for(const char of value) {const w=ctx.measureText(char).width,angle=(advance+w/2)/e.radius;ctx.save();ctx.translate(e.x+Math.sin(angle)*e.radius,e.y+e.radius+18-Math.cos(angle)*e.radius);ctx.rotate(angle);ctx.textBaseline='alphabetic';ctx.fillText(char,0,0);ctx.restore();advance+=w}
  } else if(e.kind==='text') { font(e.font,e.weight);ctx.fillText(content(e),e.x,e.y) }
  else if(e.kind==='heart') icon('heart',e.x,e.y,e.width,t.heart)
  else if(e.kind==='back') icon('back',e.x,e.y,e.width,t.primary)
  else if(e.kind==='dots') {
    for(let i=0;i<2;i++){ctx.fillStyle=(screen==='options'?i===1:i===0)?t.primary:'#6732b2';ctx.beginPath();ctx.arc(e.x+(i?5:-5),e.y,e.radius,0,Math.PI*2);ctx.fill()}
  } else if(e.kind==='primary') {
    const b=config.button,box=bounds(e),w=b.width,h=b.height,r=Math.min(b.corner,h*.28),side=h*b.bowl
    ctx.save();ctx.translate(box.x,box.y);ctx.beginPath();ctx.moveTo(r,0);ctx.lineTo(w-r,0);ctx.quadraticCurveTo(w,0,w,r);ctx.lineTo(w,side);ctx.bezierCurveTo(w,h*.65,w*.76,h,w*.5,h);ctx.bezierCurveTo(w*.24,h,0,h*.65,0,side);ctx.lineTo(0,r);ctx.quadraticCurveTo(0,0,r,0);ctx.closePath();ctx.fillStyle=t.primary;ctx.fill();ctx.restore()
    font(b.font,700);const text=buttonLabel(),tw=ctx.measureText(text).width,total=tw+b.icon+b.gap,x=b.x-total/2,y=box.y+h/2
    icon(screen==='rest'?'pause':screen==='load'?'check':'play',x+b.icon/2,y,b.icon,'#201130');ctx.fillStyle='#201130';ctx.textAlign='left';ctx.fillText(text,x+b.icon+b.gap,y)
  } else if(e.kind==='metric') {
    pill(e);const number=e.id==='reps'?config.sample.reps:config.sample.load,unit=e.id==='reps'?'reps':config.sample.unit
    font(e.font,700);const nw=ctx.measureText(number).width;font(e.unitFont,500);const uw=ctx.measureText(' '+unit).width,x=e.x-(nw+uw)/2
    ctx.textAlign='left';ctx.fillStyle=t.ink;font(e.font,700);ctx.fillText(number,x,e.y);font(e.unitFont,500);ctx.fillText(' '+unit,x+nw,e.y)
  } else if(e.kind==='adjust') { pill(e,true);font(e.font,600);ctx.fillStyle='#201130';ctx.fillText(e.text,e.x,e.y) }
  else { pill(e);font(e.font,600);ctx.fillStyle=t.ink;ctx.fillText(e.text,e.x,e.y);if(e.kind==='option'){icon(e.icon,e.x-e.width/2+18,e.y,18,t.ink);icon('chevron',e.x+e.width/2-15,e.y,16,t.ink)} }
}
function draw() {
  const pixels=Math.round(Number($('device').value)*Math.min(devicePixelRatio,2)*2),scale=pixels/225
  for(const id of ['layout','selection','background']) if($(id).width!==pixels){$(id).width=$(id).height=pixels}
  ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,225,225)
  for(const e of elements())drawElement(e)
  overlay.setTransform(scale,0,0,scale,0,0);overlay.clearRect(0,0,225,225)
  if($('guides').checked) {
    const e=element();if(e && !e.hidden){const b=bounds(e);overlay.strokeStyle='#d7ffea';overlay.lineWidth=.7;overlay.setLineDash([3,2]);overlay.strokeRect(b.x-2,b.y-2,b.w+4,b.h+4);overlay.setLineDash([])}
  }
  drawBackground();needsDraw=false
}
let gl, program, buffer, indices, phaseLocation
function setupBackground() {
  gl=$('background').getContext('webgl',{alpha:false,preserveDrawingBuffer:true})
  if(!gl){status('Animação indisponível neste navegador. A prévia estática continua funcionando.');$('background').style.background=`center / cover url("${background.src}")`;return}
  const vertex=`attribute vec2 uv;varying vec2 tex;uniform float time;void main(){tex=uv;vec2 i=clamp((uv-.1)/.8,0.,1.);float envelope=sin(i.x*3.14159265)*sin(i.y*3.14159265);vec2 warp=vec2((sin(uv.y*6.2831853+time)-sin(uv.y*6.2831853))*.055,(sin(uv.x*6.2831853+time*.8)-sin(uv.x*6.2831853))*.040)*envelope;vec2 p=uv+warp;gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);}`
  const fragment=`precision mediump float;varying vec2 tex;uniform sampler2D image;void main(){gl_FragColor=texture2D(image,tex);}`
  const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s}
  program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);gl.useProgram(program)
  const verts=[],faces=[];for(let y=0;y<=20;y++)for(let x=0;x<=20;x++){verts.push(x/20,y/20);if(x<20 && y<20){const i=y*21+x;faces.push(i,i+1,i+21,i+1,i+22,i+21)}}
  buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(verts),gl.STATIC_DRAW)
  const attr=gl.getAttribLocation(program,'uv');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0)
  indices=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(faces),gl.STATIC_DRAW)
  const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,background)
  phaseLocation=gl.getUniformLocation(program,'time');drawBackground()
}
function drawBackground() {if(!gl || !loaded)return;gl.viewport(0,0,$('background').width,$('background').height);gl.uniform1f(phaseLocation,$('animate').checked?phase:0);gl.drawElements(gl.TRIANGLES,2400,gl.UNSIGNED_SHORT,0)}
function frame(now) {
  if(!document.hidden && now-lastFrame>=150){if($('animate').checked && !matchMedia('(prefers-reduced-motion: reduce)').matches)phase+=.06;if(needsDraw)draw();else if($('animate').checked)drawBackground();lastFrame=now}
  requestAnimationFrame(frame)
}
function point(event) {const r=$('layout').getBoundingClientRect();return{x:(event.clientX-r.left)*225/r.width,y:(event.clientY-r.top)*225/r.height}}
$('layout').onpointerdown=event=>{
  const p=point(event),hit=[...elements()].reverse().find(e=>{if(e.hidden)return false;const b=bounds(e);return p.x>=b.x-3&&p.x<=b.x+b.w+3&&p.y>=b.y-3&&p.y<=b.y+b.h+3})
  if(!hit)return;select(hit.id);remember();dragging={start:p,before:clone(hit.kind==='primary'?config.button:hit)};$('layout').setPointerCapture(event.pointerId);$('layout').focus()
}
$('layout').onpointermove=event=>{if(!dragging)return;const p=point(event),e=element(),dx=p.x-dragging.start.x,dy=p.y-dragging.start.y
  if(e.kind==='primary'){config.button.x=Math.max(48,Math.min(177,Math.round((dragging.before.x+dx)*2)/2));config.button.bottom=Math.max(0,Math.min(50,Math.round((dragging.before.bottom-dy)*2)/2))}
  else{e.x=Math.max(0,Math.min(225,Math.round((dragging.before.x+dx)*2)/2));e.y=Math.max(0,Math.min(225,Math.round((dragging.before.y+dy)*2)/2))}changed()
}
function endDrag(){if(dragging){dragging=null;controls();sharedControls()}}
$('layout').onpointerup=endDrag;$('layout').onpointercancel=endDrag
$('layout').onkeydown=event=>{const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!delta)return;event.preventDefault();remember();const e=element(),step=event.shiftKey?5:.5
  if(e.kind==='primary'){config.button.x=Math.max(48,Math.min(177,config.button.x+delta[0]*step));config.button.bottom=Math.max(0,Math.min(50,config.button.bottom-delta[1]*step))}else{e.x=Math.max(0,Math.min(225,e.x+delta[0]*step));e.y=Math.max(0,Math.min(225,e.y+delta[1]*step))}refresh();changed()}
$('element').onchange=()=>select($('element').value)
$('undo').onclick=()=>{if(!undo.length)return;config=undo.pop();refresh();changed()}
$('reset-element').onclick=()=>{remember();const e=element();if(e.kind==='primary')config.button=clone(defaults.button);const index=elements().findIndex(x=>x.id===selected);elements()[index]=clone(defaults.screens[screen][index]);refresh();changed()}
$('reset').onclick=()=>{remember();config=clone(defaults);refresh();changed();status('Layout original restaurado. Você pode desfazer esta ação.')}
for(const id of ['guides','device','animate'])$(id).onchange=()=>{phase=0;needsDraw=true}
function download(blob,name) {const url=URL.createObjectURL(blob),a=node('a',{href:url,download:name},document.body);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
$('export').onclick=()=>{download(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}),'opengym-wear-layout.json');status('Ajustes exportados. Envie esse arquivo para aplicarmos ao APK.')}
$('import').onclick=()=>$('file').click()
$('file').onchange=async()=>{const file=$('file').files[0];if(!file)return;try{if(file.size>200000)throw new Error('O arquivo é grande demais.');const next=validateLayout(JSON.parse(await file.text()));remember();config=next;refresh();changed();status('Ajustes importados.')}catch(e){status('Não foi possível importar: '+e.message)}finally{$('file').value=''}}
$('png').onclick=()=>{draw();const out=document.createElement('canvas');out.width=out.height=$('layout').width;const c=out.getContext('2d');c.beginPath();c.arc(out.width/2,out.height/2,out.width/2,0,Math.PI*2);c.clip();if(gl)c.drawImage($('background'),0,0);else c.drawImage(background,0,0,out.width,out.height);c.drawImage($('layout'),0,0);out.toBlob(blob=>{if(blob)download(blob,'opengym-'+screen+'.png')},'image/png')}
document.fonts.ready.then(()=>{needsDraw=true});window.addEventListener('resize',()=>{needsDraw=true})
refresh();draw();requestAnimationFrame(frame)
