/** The original interruption reproduction is now the installed-SDK regression in check/connection.ts. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const native = fileURLToPath(new URL('../../../outputs/teamledger-color/app-native/', import.meta.url));
execFileSync('npm', ['run', 'check:connection'], { cwd: native, stdio: 'inherit' });
