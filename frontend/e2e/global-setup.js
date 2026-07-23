import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(here, '../../backend');
const statePath = resolve(here, '.auth/state.json');

// Mint a real DB-backed session for the test user (same SQLite the dev server
// reads), then persist it as a Playwright storageState cookie for localhost.
export default function globalSetup() {
    const out = execFileSync('uv', ['run', 'python', 'e2e_seed_session.py'], {
        cwd: backendDir,
        env: { ...process.env, DEBUG: 'true', APP_ENV: 'local' },
        encoding: 'utf-8',
    });
    const sessionKey = out.trim().split('\n').pop().trim();
    if (!sessionKey) throw new Error('Failed to obtain a session key from e2e_seed_session.py');

    const state = {
        cookies: [{
            name: 'sessionid',
            value: sessionKey,
            domain: 'localhost',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
        }],
        origins: [],
    };

    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    console.log(`[global-setup] seeded session ${sessionKey.slice(0, 6)}… for e2e-tester`);
}
