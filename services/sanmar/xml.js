// Lector XML mínimo (sin dependencias) para respuestas SOAP.
// Quita prefijos de namespace, decodifica entidades y arma un árbol { name, attrs, text, children }.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

export function escapeXml(s) {
  return String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

const localName = (n) => (n.includes(':') ? n.slice(n.lastIndexOf(':') + 1) : n);

function parseAttrs(src = '') {
  const attrs = {};
  const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(src))) attrs[localName(m[1])] = decodeEntities(m[2] ?? m[3]);
  return attrs;
}

export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, text: '', children: [] };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      const name = localName(m[2]);
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].name === name) { stack.length = i; break; }
    } else if (m[3]) {
      const node = { name: localName(m[3]), attrs: parseAttrs(m[4]), text: '', children: [] };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decodeEntities(m[6]);
  }
  return root;
}

/** Todos los descendientes con ese nombre (búsqueda en profundidad). */
export function findAll(node, name, out = []) {
  for (const c of node?.children || []) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
export const find = (node, name) => findAll(node, name)[0] || null;

/** Texto del primer descendiente con ese nombre (null si falta, está vacío o es xsi:nil). */
export function textOf(node, ...names) {
  for (const name of names) {
    const n = name === node?.name ? node : find(node, name);
    if (!n || n.attrs?.nil === 'true') continue;
    const t = n.text.trim();
    if (t !== '') return t;
  }
  return null;
}

export function numberOf(node, ...names) {
  const t = textOf(node, ...names);
  if (t == null) return null;
  const n = Number(t.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Nodos que tienen hijos directos con todos los nombres dados (para encontrar "registros"). */
export function findRecords(node, predicate, out = []) {
  for (const c of node?.children || []) {
    if (predicate(c)) out.push(c);
    else findRecords(c, predicate, out);
  }
  return out;
}
export const childNames = (node) => new Set((node?.children || []).map((c) => c.name));

/** Estructura de etiquetas con valores ocultos: sirve para diagnosticar sin exponer datos de la cuenta. */
export function structure(node, depth = 0, seen = new Map()) {
  const lines = [];
  const counts = new Map();
  for (const c of node.children) counts.set(c.name, (counts.get(c.name) || 0) + 1);
  const printed = new Set();
  for (const c of node.children) {
    if (printed.has(c.name)) continue;
    printed.add(c.name);
    const n = counts.get(c.name);
    const leaf = !c.children.length;
    const value = leaf ? (c.text.trim() === '' ? ' (vacío)' : /^-?[\d.,]+$/.test(c.text.trim()) ? ' = #' : ' = …') : '';
    lines.push(`${'  '.repeat(depth)}${c.name}${n > 1 ? ` ×${n}` : ''}${value}`);
    if (!leaf) lines.push(...structure(c, depth + 1, seen));
  }
  return lines;
}
