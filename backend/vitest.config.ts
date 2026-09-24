import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The first run downloads a mongod binary, so hooks get a long timeout.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/life-tracker-test',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      CRON_SECRET: 'test-cron-secret-that-is-at-least-32-chars',
      CLIENT_URL: 'http://localhost:5173',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      SMTP_USER: 'test',
      SMTP_PASS: 'test',
      MAIL_FROM: 'Life Tracker <no-reply@example.com>',
    },
  },
})
