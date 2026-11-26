/**
 * Deterministic ledger denoise: render accumulated entries as the current
 * state, not as an append-only changelog.
 *
 * The journal keeps every entry. Before rendering (and before the byte cap),
 * entries that describe the same subject are folded to the newest one, and a
 * run of test-count observations is folded to the latest result. That removes
 * the stale-version residue that used to fill the cap and push unique facts
 * out, without a model call and without changing any retained text.
 */

const PATH = /((?:(?:[A-Za-z0-9_.-]+[\\/])+)?(?:\.(?:gitignore|env|npmrc)|[A-Za-z0-9_.-]+\.(?:[cm]?[jt]sx?|py|json|md|ya?ml|toml|ini|cfg|conf)))(?::|\b)/
// A statement has to name a changeable property; plain prose is never folded.
const STATE_WORD = /(?:=|\b(?:returns|throws|default|defaults|header|options|slice|slices|sort|sorts|applies|uses|takes|wraps|prints|documents|suppresses|overrides|counts|exports|accepts|rejects|requires|validates|emits|appends|maps|keeps|removes|include|includes|contain|contains|list|lists)\b)/i
// A later statement that says a named thing was archived/deleted/present is a
// version of that subject even without a `= value` shape.
const STATE_CHANGE = /\b(?:still present|present|archived|deleted|removed|retained|kept|renamed|replaced|superseded|deprecated)\b/i
const TEST_RESULT = /\b(?:passes? \d+\s*\/\s*\d+|tests?\s+\d+\s*,\s*pass|tests?:\s*\d+ tests?, \s*\d+ pass|\d+ tests?, \s*pass \d+)/i
// The sandbox's spawn failure is stated once; every later copy is noise.
const TEST_ENV = /spawn EPERM|errno = -4048|syscall = spawn|test-isolation=none.*EPERM/i
const EXEMPT_KINDS = new Set(['constraint', 'requirement'])
const TEST_KEY = '__test_result__'
const ENV_KEY = '__test_environment__'

const normalizePath = (value) => String(value ?? '').toLowerCase().replace(/\\/g, '/')
// `REPORT_LIMIT` and `reportLimit` name the same subject.
const normalizeName = (value) => String(value ?? '').toLowerCase().replace(/_/g, '')
const clock = (entry) => Number(entry?.seq ?? entry?.order ?? 0)
const stripPrefix = (text) => String(text ?? '')
  .replace(/^(?:decision|context|constraint|requirement|verification):\s*/i, '')
  .trim()

// A lead phrase with a proper token (XeyoUI, HTTP, A4) before a state verb is
// a subject; a lowercase English sentence is not.
const proseSubject = (text) => {
  const match = STATE_CHANGE.exec(text)
  if (match === null) return ''
  const lead = text.slice(0, match.index).trim()
  if (lead.length < 3 || lead.length > 80) return ''
  if (!/.[A-Z]|\d/.test(lead)) return ''
  const key = lead.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5/.-]+/g, ' ').trim()
  return key === '' ? '' : `prose:${key}`
}

const pathSegments = (path) => String(path ?? '').split('/').filter((segment) => segment !== '')
// A relative path and its absolute form, or a full path and its abbreviated
// spelling, name the same file. Two unrelated directories do not.
const isSubsequence = (small, big) => {
  let index = 0
  for (const segment of big) {
    if (segment === small[index]) index += 1
  }
  return index === small.length
}
export const relatedPaths = (left, right) => {
  if (left === right) return true
  if (left === '' || right === '') return false
  const a = pathSegments(left)
  const b = pathSegments(right)
  return isSubsequence(a, b) || isSubsequence(b, a)
}

const subjectParts = (text) => {
  const t = stripPrefix(text)
  if (t === '') return { key: '', path: '', valueLike: false }
  const prose = proseSubject(t)
  if (!STATE_WORD.test(t) && prose === '') return { key: '', path: '', valueLike: false }
  const flags = [...new Set((t.match(/--[a-z][a-z-]+/g) ?? []))].sort().join(' ')
  // Two calls with different literal arguments are different facts
  // (`formatCents(-350)` vs `formatCents(123456789)`), and an empty-argument
  // call is its own case (`toCsv([])`).
  const argText = /\(([^)]*)\)/.exec(t)?.[1] ?? ''
  const numeric = /\d/.test(argText) ? `::#${(argText.match(/-?\d+(?:\.\d+)?/) ?? [''])[0]}` : ''
  const empty = /\(/.test(t) && /^[[\]\s]*$/.test(argText) ? '::empty' : ''
  const suffix = `${flags === '' ? '' : `::${flags}`}${numeric}${empty}`
  const path = PATH.exec(t)?.[1]
  if (path !== undefined) {
    const rest = t.slice(t.indexOf(path) + path.length)
    const first = /[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest)?.[0]
    if (first !== undefined) {
      // Numeric/boolean properties are measurements: the same basename and
      // property are versions even when one path is written short. Unrelated
      // directories are still separated at grouping time.
      const valueLike = /=\s*(?:-?\d+(?:\.\d+)?|true|false)\b/i.test(rest)
      const normalized = normalizePath(path)
      const canonical = valueLike
        ? (normalized.split('/').filter(Boolean).pop() ?? normalized)
        : normalized
      return { key: `${canonical}::${normalizeName(first)}${suffix}`, path: normalized, valueLike }
    }
  }
  // A proper lead plus a state verb is a stronger subject than a later
  // parenthetical; `deleted (surface prune)` is not a function.
  if (prose !== '') return { key: prose, path: '', valueLike: false }
  // Do not require a closing paren: signatures that contain a nested call
  // (`taxCents(cents, rate = envTaxRate())`) still fold by function name.
  const call = /([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^\n]{0,160})/.exec(t)
  if (call !== null) {
    const seen = new Set()
    const args = String(call[2]).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []
    for (const name of args) {
      const lower = name.toLowerCase()
      if (['default', 'options', 'args', 'value', 'text'].includes(lower)) continue
      seen.add(lower)
      if (seen.size >= 2) break
    }
    return {
      key: `fn:${normalizeName(call[1])}(${[...seen].map(normalizeName).join(',')})${suffix}`,
      path: '',
      valueLike: false,
    }
  }
  return { key: prose, path: '', valueLike: false }
}

/**
 * Stable subject key, or '' when the entry must not be folded.
 *
 * The key is path (or function call) plus the first identifier and any
 * `--flag` tokens. Flags keep `parseArgs throws '--round'` and
 * `parseArgs throws '--sort'` apart; property names merge their versions.
 */
export function subjectKey(text) {
  return subjectParts(text).key
}

/**
 * A claim that carries a probe-able value: a decimal, a flag, a quoted
 * literal or a return shape. The cap keeps these before plain prose.
 */
export function hasValue(text) {
  return /\b\d+\.\d+\b|--[a-z][a-z-]+|`[^`]{2,}`|\breturns?\b/i.test(String(text ?? ''))
}

/**
 * @param {ReadonlyArray<object>} entries journal entries (any status).
 * @returns {{ entries: object[], superseded: number, folded: number }}
 */
export function denoiseLedger(entries) {
  const active = (entries ?? []).filter((entry) => (entry.status ?? 'active') === 'active')
  const groups = new Map()
  const kept = []
  for (const entry of active) {
    if (EXEMPT_KINDS.has(entry.kind)) {
      kept.push(entry)
      continue
    }
    const text = String(entry.text ?? '')
    const plain = stripPrefix(text)
    let key
    let path = ''
    let valueLike = false
    if (TEST_RESULT.test(plain)) key = TEST_KEY
    else if (TEST_ENV.test(plain)) key = ENV_KEY
    else {
      const parts = subjectParts(text)
      key = parts.key
      path = parts.path
      valueLike = parts.valueLike
    }
    if (key === '') {
      kept.push(entry)
      continue
    }
    const list = groups.get(key)
    const item = { entry, path, valueLike }
    if (list === undefined) groups.set(key, [item])
    else list.push(item)
  }
  let superseded = 0
  let folded = 0
  const keepNewest = (items, key) => {
    items.sort((a, b) => clock(a.entry) - clock(b.entry)
      || String(a.entry.id ?? '').localeCompare(String(b.entry.id ?? '')))
    kept.push(items[items.length - 1].entry)
    superseded += items.length - 1
    if (key === TEST_KEY) folded += items.length - 1
  }
  for (const [key, list] of groups) {
    // A basename-collapsed key can merge unrelated files; only fold entries
    // whose paths are a relative/absolute or shortened spelling of one another.
    const collapsed = list.some((item) => item.valueLike) && !key.includes('/')
    if (!collapsed) {
      if (list.length === 1) kept.push(list[0].entry)
      else keepNewest(list, key)
      continue
    }
    const clusters = []
    for (const item of list) {
      const cluster = item.path === ''
        ? undefined
        : clusters.find((rows) => rows.some((row) => row.path !== '' && relatedPaths(row.path, item.path)))
      if (cluster === undefined) clusters.push([item])
      else cluster.push(item)
    }
    for (const cluster of clusters) {
      if (cluster.length === 1) kept.push(cluster[0].entry)
      else keepNewest(cluster, key)
    }
  }
  kept.sort((a, b) => clock(a) - clock(b) || String(a.id ?? '').localeCompare(String(b.id ?? '')))
  return { entries: kept, superseded, folded }
}

/** Strip a duplicated kind label and flatten literal escapes for display. */
export function cleanEntryText(text) {
  // Real line breaks become a separator; a literal `\n` is code content and
  // stays untouched.
  return stripPrefix(text)
    .replace(/[\r\n]+/g, ' / ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}
