import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONTRACT_FILES, type ContractVersion, installedHermes, VERSION_FILE, WIRE_DIR } from './hermes-install'

const hermes = installedHermes()
for (const file of CONTRACT_FILES) copyFileSync(join(hermes.dir, file.hermes), join(WIRE_DIR, file.vendored))
const version: ContractVersion = { hermes: hermes.version, commit: hermes.commit }
writeFileSync(VERSION_FILE, JSON.stringify(version, null, 2) + '\n')
console.log(`vendored the gateway contract of Hermes ${hermes.version} (${hermes.commit.slice(0, 12)}) from ${hermes.dir}`)
