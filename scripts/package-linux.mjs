// Stages the built desktop app as the Electron `resources/app` directory.
//
//   node scripts/package-linux.mjs <stage-dir> [--app apps/desktop] [--version 0.1.0]
//
// The staged app has no node_modules, so a bare import in the main or preload
// bundle crashes at launch on the user's machine. This script fails the build
// instead.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import ts from 'typescript'

const SHIPPED = new Set(['electron', ...builtinModules])
const BUNDLES = ['main', 'preload']
const SCRIPT = /\.(?:[cm]?js)$/

const fail = message => {
  console.error(`package-linux: ${message}`)
  process.exit(1)
}

const scripts = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? scripts(path) : SCRIPT.test(entry.name) ? [path] : []
  })

const isShipped = specifier => /^(?:\.|\/|node:)/.test(specifier) || SHIPPED.has(specifier)

const unshippedImports = file =>
  ts
    .preProcessFile(readFileSync(file, 'utf8'), true, true)
    .importedFiles.map(imported => imported.fileName)
    .filter(specifier => !isShipped(specifier))

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { app: { type: 'string', default: 'apps/desktop' }, version: { type: 'string' } }
})
const [stageArg] = positionals
if (stageArg === undefined || positionals.length > 1) fail('usage: package-linux.mjs <stage-dir> [--app <dir>] [--version <x.y.z>]')

const appDir = resolve(values.app)
const outDir = join(appDir, 'out')
const manifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))

if (!existsSync(join(appDir, manifest.main))) {
  fail(`${relative(process.cwd(), join(appDir, manifest.main))} does not exist. Run "pnpm --filter ${manifest.name} build" first.`)
}
if (values.version !== undefined && values.version !== manifest.version) {
  fail(`${manifest.name} is version ${manifest.version} but the package is version ${values.version}. Make them match.`)
}

const offenders = BUNDLES.flatMap(name => scripts(join(outDir, name)))
  .map(file => ({ file, specifiers: [...new Set(unshippedImports(file))] }))
  .filter(({ specifiers }) => specifiers.length > 0)

if (offenders.length > 0) {
  const lines = offenders.map(({ file, specifiers }) => `  ${relative(process.cwd(), file)} imports ${specifiers.join(', ')}`)
  fail(`the bundle imports packages that the app does not ship. Bundle them in electron.vite.config.ts.\n${lines.join('\n')}`)
}

const stage = resolve(stageArg)
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
cpSync(outDir, join(stage, 'out'), { recursive: true })
const { name, productName, version, type, main } = manifest
writeFileSync(join(stage, 'package.json'), `${JSON.stringify({ name, productName, version, type, main }, null, 2)}\n`)

console.log(`package-linux: staged ${productName} ${version} in ${stage}`)
