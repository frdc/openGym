// All emitted code and styles, including locale, instruction and name packs.
export function lazyAssets(bundle) {
  return Object.keys(bundle).filter(file => /\.(?:js|css)$/.test(file)).map(file => './' + file).sort()
}
export function stampSw(source, { stamp, lazy = [] }) {
  return source.replace('__BUILD__', () => stamp).replace("'__LAZY__'", () => JSON.stringify(JSON.stringify(lazy)))
}
