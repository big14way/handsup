// Writes the manifest that goes into the .ehpk: the same as app.json, minus the
// localhost entries that only exist so `npm run dev` can reach a local server.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('app.json', 'utf8'))
for (const permission of manifest.permissions ?? []) {
  if (Array.isArray(permission.whitelist)) {
    permission.whitelist = permission.whitelist.filter(origin => !/^https?:\/\/(localhost|127\.0\.0\.1)\b/.test(origin))
  }
}
mkdirSync('release', { recursive: true })
writeFileSync('release/app.json', JSON.stringify(manifest, null, 2) + '\n')
console.log('release/app.json network whitelist:', manifest.permissions.find(p => p.name === 'network')?.whitelist)
