import { defineConfig, devices } from '@playwright/test';

// End-to-end tests for the budget screen, run on a desktop viewport ("web") and
// a mobile device profile ("mobile"). Auth is handled by global-setup.js, which
// seeds a real Django session and drops the cookie into storageState — so these
// exercise the full stack (React SPA → Vite proxy → Django + SQLite), skipping
// only the Google OAuth redirect.
export default defineConfig({
    testDir: './e2e',
    globalSetup: './e2e/global-setup.js',
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    timeout: 30_000,
    expect: { timeout: 10_000 },

    use: {
        baseURL: 'http://localhost:5173',
        storageState: 'e2e/.auth/state.json',
        trace: 'retain-on-failure',
    },

    projects: [
        { name: 'web', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
        { name: 'mobile', use: { ...devices['Pixel 5'] } },
    ],

    // Boot backend + frontend for the run; reuse them if already up locally.
    webServer: [
        {
            command: 'cd ../backend && DEBUG=true APP_ENV=local uv run manage.py runserver 0.0.0.0:8000',
            url: 'http://localhost:8000/admin/login/',
            reuseExistingServer: true,
            timeout: 120_000,
        },
        {
            command: 'npm run dev',
            url: 'http://localhost:5173',
            reuseExistingServer: true,
            timeout: 120_000,
        },
    ],
});
