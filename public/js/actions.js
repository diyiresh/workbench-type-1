// Action registry for [data-act] buttons. A feature registers its handlers once;
// the global click listener in app.js looks the name up here.
// handler(element, event) may be async; return value is ignored.
const registry = new Map();

export function defineActions(feature, handlers) {
  for (const [name, handler] of Object.entries(handlers)) {
    if (registry.has(name)) throw new Error(`action "${name}" already registered by ${registry.get(name).feature}`);
    registry.set(name, { feature, handler });
  }
}

export async function runAction(name, element, event) {
  const entry = registry.get(name);
  if (!entry) return false;
  await entry.handler(element, event);
  return true;
}

export function actionNames() {
  return [...registry].map(([name, { feature }]) => ({ name, feature }));
}
