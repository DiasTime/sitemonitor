import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * The monitoring run starts from a bare checkout: the workflow skips `npm ci`
 * so that a run fits inside one billed minute, and fetches only tsx. Any npm
 * package reachable from scripts/monitor.ts would therefore crash every run —
 * a gap in monitoring caused by an import. This walks the same import graph
 * the run loads and fails on the first bare specifier that is not `node:`.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = path.join(ROOT, 'scripts/monitor.ts')

/** Static and re-exporting imports. `import type` / `export type` vanish at runtime and are skipped. */
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
const DYNAMIC_IMPORT = /\b(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g

function specifiersOf(source: string): string[] {
  const found: string[] = []
  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
    for (const match of source.matchAll(pattern)) found.push(match[1])
  }
  return found
}

function resolveLocal(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? path.join(ROOT, specifier.slice(2))
    : path.resolve(path.dirname(from), specifier)
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]
  if (/\.tsx?$/.test(base)) candidates.unshift(base)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function walk(): { files: string[]; packages: string[] } {
  const seen = new Set<string>()
  const packages: string[] = []
  const queue = [ENTRY]

  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)

    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('node:')) continue
      if (specifier.startsWith('.') || specifier.startsWith('@/')) {
        const resolved = resolveLocal(file, specifier)
        assert.ok(resolved, `${path.relative(ROOT, file)} imports ${specifier}, which does not resolve`)
        queue.push(resolved)
        continue
      }
      packages.push(`${path.relative(ROOT, file).replace(/\\/g, '/')} -> ${specifier}`)
    }
  }

  return { files: [...seen], packages }
}

test('the monitoring run needs nothing but Node', () => {
  const { packages } = walk()
  assert.deepEqual(
    packages,
    [],
    'scripts/monitor.ts runs without npm ci, so everything it loads may import only ' +
      'node: built-ins and local files. Move the npm-dependent code out of its import graph.',
  )
})

test('the walk really follows the graph', () => {
  // Guards the guard: a scanner that silently stopped at the entry file would
  // pass the test above no matter what the graph imported.
  const files = walk().files.map((file) => path.relative(ROOT, file).replace(/\\/g, '/'))
  for (const expected of ['lib/telegram.ts', 'lib/transitions.ts', 'lib/utils.ts', 'lib/ru.ts']) {
    assert.ok(files.includes(expected), `expected the walk to reach ${expected}`)
  }
})
