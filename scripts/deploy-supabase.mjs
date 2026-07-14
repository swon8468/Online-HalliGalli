import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const environment = process.argv[2]
if (!['development', 'production'].includes(environment)) throw new Error('Usage: node scripts/deploy-supabase.mjs <development|production>')
const functionsOnly = process.argv[3] === '--functions-only'
const requestedFunctions = functionsOnly ? process.argv.slice(4) : []
const edgeFunctions = [
  ['bootstrap-super-admin', '--no-verify-jwt'],
  ['send-push'],
  ['admin-actions'],
  ['check-identifier', '--no-verify-jwt'],
  ['delete-account'],
  ['space-admin'],
  ['delete-card-set'],
]
if (functionsOnly && requestedFunctions.length === 0) throw new Error('At least one Edge Function is required with --functions-only')
const unknownFunctions = requestedFunctions.filter(name => !edgeFunctions.some(([known]) => known === name))
if (unknownFunctions.length > 0) throw new Error(`Unknown Edge Function: ${unknownFunctions.join(', ')}`)

function readEnv(path) {
  if (!existsSync(path)) return {}
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const separator = line.indexOf('=')
    return [line.slice(0, separator), line.slice(separator + 1)]
  }))
}

const appEnv = readEnv(`.env.${environment}`)
const functionEnvPath = `supabase/.env.${environment}.local`
const functionEnv = readEnv(functionEnvPath)
const commandEnv = { ...process.env, ...appEnv, ...functionEnv }

if (!commandEnv.SUPABASE_ACCESS_TOKEN) throw new Error(`SUPABASE_ACCESS_TOKEN is missing from .env.${environment}`)
if (!commandEnv.VITE_SUPABASE_URL) throw new Error(`VITE_SUPABASE_URL is missing from .env.${environment}`)
const projectRef = new URL(commandEnv.VITE_SUPABASE_URL).hostname.split('.')[0]
if (!projectRef) throw new Error('Could not derive Supabase project ref')

function run(args) {
  const result = spawnSync('npx', ['supabase', ...args], { stdio: 'inherit', env: commandEnv, cwd: process.cwd() })
  if (result.status !== 0) throw new Error(`Supabase command failed: ${args[0]}`)
}

if (!functionsOnly) {
  const linkArgs = ['link', '--project-ref', projectRef]
  if (commandEnv.SUPABASE_DB_PASSWORD) linkArgs.push('--password', commandEnv.SUPABASE_DB_PASSWORD)
  console.log(`${environment}: linking project ${projectRef}`)
  run(linkArgs)
  console.log(`${environment}: applying database migrations`)
  run(['db', 'push', '--linked', '--include-all', '--yes'])
  console.log(`${environment}: setting Edge Function secrets`)
  run(['secrets', 'set', '--env-file', functionEnvPath, '--project-ref', projectRef])
}

const functionsToDeploy = functionsOnly ? edgeFunctions.filter(([name]) => requestedFunctions.includes(name)) : edgeFunctions
console.log(`${environment}: deploying ${functionsToDeploy.map(([name]) => name).join(', ')}`)
for (const [name, extraFlag] of functionsToDeploy) {
  run(['functions', 'deploy', name, '--project-ref', projectRef, ...(extraFlag ? [extraFlag] : []), '--use-api'])
}
console.log(`${environment}: ${functionsOnly ? 'selected Edge Function' : 'Supabase'} deployment complete`)
