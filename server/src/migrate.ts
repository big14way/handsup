import { readFileSync } from 'node:fs'
import { sql } from './db.js'

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) {
  await sql.query(statement)
}
console.log('schema applied')
