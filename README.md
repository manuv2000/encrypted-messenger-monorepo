# Encrypted Messenger

A full-stack messaging project built with Svelte, TypeScript, and NestJS, exploring device-based message delivery and end-to-end encryption.

**Status:** In development. Authentication, message delivery, and browser synchronization work. Cryptographic key generation and message encryption/decryption are not yet implemented; current tests use placeholder payloads.

## Features

- Account registration and login
- JWT authentication with refresh-token rotation
- Device registration and ownership checks
- Direct conversations between users
- Per-device message envelopes and delivery acknowledgements
- Real-time notifications through Socket.IO
- Offline message retrieval and synchronization after reconnecting
- Local browser inbox storage using IndexedDB
- Browser interface for testing message delivery

## Technology

| Layer | Stack |
| --- | --- |
| Frontend | Svelte, TypeScript, Vite |
| Backend | NestJS, TypeScript |
| Database | PostgreSQL, Prisma |
| Real-time communication | Socket.IO |
| Local storage | IndexedDB |

## Repository

- `apps/api` — backend, database schema, migrations, and API requests
- `apps/web` — browser application

## How message delivery works

The backend stores a message with envelopes addressed to recipient devices. Connected devices receive a notification and fetch their messages through the API.

The browser saves received messages locally before acknowledging delivery. After reconnecting, it synchronizes its inbox to retrieve messages sent while it was offline.

## Local development

Requirements: Node.js compatible with the projects' dependencies, npm, and PostgreSQL.

Install dependencies from the repository root:

```sh
npm --prefix apps/api ci
npm --prefix apps/web ci
```

Configure the backend environment in `apps/api/.env` with the database connection and authentication settings required by the application.

Prepare the database from `apps/api`:

```sh
npx prisma generate
npx prisma migrate deploy
```

Run the backend and frontend in separate terminals from the repository root:

```sh
npm --prefix apps/api run start:dev
```

```sh
npm --prefix apps/web run dev
```

Open http://localhost:5173. The frontend development proxy connects to the backend on port 3000.

## Next steps

- Implement client-side cryptographic key management
- Encrypt and decrypt messages on recipient devices
- Improve the conversation interface
- Test the browser experience on Android
- Prepare deployment configuration

## Project scope

This is a portfolio and learning project under active development. It is not yet suitable for confidential communication.