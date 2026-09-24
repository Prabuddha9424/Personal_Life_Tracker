import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/life-tracker-test',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      CLIENT_URL: 'http://localhost:5173',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      SMTP_USER: 'test',
      SMTP_PASS: 'test',
      MAIL_FROM: 'Life Tracker <no-reply@example.com>',
    },
  },
})
