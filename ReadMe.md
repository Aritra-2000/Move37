# 🗳️ Real-Time Polling API

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9%2B-blue)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma)](https://www.prisma.io/)
[![WebSockets](https://img.shields.io/badge/WebSockets-Socket.IO-010101?logo=socket.io)](https://socket.io/)

> A real-time polling application backend built with Node.js, Express, PostgreSQL, Prisma, and WebSockets.

---

## Table of Contents

* [Project Overview](#project-overview)
* [Tech Stack](#tech-stack)
* [Features](#features)
* [Repository Structure](#repository-structure)
* [Prisma Schema](#prisma-schema)
* [API Endpoints (REST)](#api-endpoints-rest)
* [WebSocket Protocol](#websocket-protocol)
* [Authentication](#authentication)
* [Setup & Run (Local)](#setup--run-local)
* [Database Migrations & Seeding](#database-migrations--seeding)
* [Testing](#testing)
* [Deployment Notes](#deployment-notes)
* [Design Notes & Decisions](#design-notes--decisions)
* [Future Improvements](#future-improvements)

---

## Project Overview

This repository contains a backend service for a real-time polling application. Users can create polls with options, other users can vote on those options, and vote counts are broadcast in real-time to connected clients viewing the poll.

The focus of this challenge is:

* A correct relational data model (Users, Polls, PollOptions, Votes)
* A RESTful API to create/read polls and submit votes
* A WebSocket layer to broadcast live updates for a poll

---

## 🛠️ Tech Stack

- **Runtime**: Node.js (v18+)
- **Web Framework**: Express
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Real-time**: Socket.IO (with `ws` fallback)
- **Authentication**: JWT
- **Environment Management**: dotenv

---

## Features

* Create and fetch users
* Create and fetch polls and their options
* Submit votes for poll options
* Real-time broadcasting of poll result updates via WebSockets
* Basic authentication scaffolding (JWT-ready)

---

## Repository Structure (recommended)

```
/ (root)
├─ src/
│  ├─ index.ts            # app entry (Express + WebSocket)
│  ├─ app.ts              # Express app setup
│  ├─ routes/
│  │  ├─ users.ts
│  │  ├─ polls.ts
│  │  └─ votes.ts
│  ├─ controllers/
│  ├─ services/
│  ├─ websocket/
│  │  └─ wsServer.ts
│  ├─ prismaClient.ts
│  └─ utils/
├─ prisma/
│  ├─ schema.prisma
│  └─ seed.ts
├─ scripts/
├─ .env
├─ package.json
└─ README.md
```

---

## Prisma Schema

Place this in `prisma/schema.prisma`.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           Int       @id @default(autoincrement())
  name         String
  email        String    @unique
  passwordHash String
  polls        Poll[]    @relation("creator_polls")
  votes        Vote[]
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
}

model Poll {
  id          Int          @id @default(autoincrement())
  question    String
  isPublished Boolean      @default(false)
  creatorId   Int
  creator     User         @relation(fields: [creatorId], references: [id], name: "creator_polls")
  options     PollOption[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}

model PollOption {
  id       Int     @id @default(autoincrement())
  text     String
  pollId   Int
  poll     Poll    @relation(fields: [pollId], references: [id])
  votes    Vote[]
}

// Many-to-Many relation implemented as an explicit join table
model Vote {
  id           Int        @id @default(autoincrement())
  userId       Int
  pollOptionId Int
  user         User       @relation(fields: [userId], references: [id])
  pollOption   PollOption @relation(fields: [pollOptionId], references: [id])
  createdAt    DateTime   @default(now())

  @@unique([userId, pollOptionId], name: "unique_user_option")
}
```

**Notes:**

* `Vote` here is a join table representing a user voting for a poll option. The unique constraint prevents a user from voting the same option multiple times. Additional application logic should ensure a user votes at most once per poll (i.e., you may enforce unique(userId, pollId) via an alternative approach or handle in logic).

---

## API Endpoints (REST)

All endpoints assume `Content-Type: application/json` unless otherwise specified.

### Authentication

#### Register a new user
```http
POST /api/users/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123"
}
```

#### Login user
```http
POST /api/users/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "password123"
}
```

### Polls

#### Get a poll by ID (public)
```http
GET /api/polls/1
```

#### Create a poll (authenticated)
```http
POST /api/polls
Content-Type: application/json
Authorization: Bearer <jwt_token>

{
  "question": "What's your favorite programming language?",
  "isPublished": true,
  "options": ["JavaScript", "TypeScript", "Python", "Go"]
}
```

#### Vote on a poll option (authenticated)
```http
POST /api/polls/1/vote/3
Authorization: Bearer <jwt_token>
```
* **POST /api/polls/\:pollId/vote** — Submit a vote (authenticated)

  * Body: `{ "optionId": 123 }`
  * Server-side logic:

    * Ensure `optionId` belongs to `pollId`.
    * Optionally ensure user hasn't already voted on this poll (one vote per user per poll). You can either:

      * Create `Vote` entries and delete previous one for other options of same poll (change votes), or
      * Reject if user already voted — depends on requirements.
  * On success: Returns updated vote counts for the poll options and broadcasts via WebSocket.

---

## WebSocket Protocol

Use WebSockets to subscribe clients to live poll updates.

**Recommendation:** use `socket.io` for rooms and reconnection handling. Alternatively `ws` with a small room-management layer.

**Namespaces / Rooms**

* Clients subscribe to a poll's updates by joining room `poll:{pollId}`.

**Client -> Server messages**

* `subscribe` — `{ type: 'subscribe', pollId: 12 }` — server adds socket to `poll:12` room
* `unsubscribe` — `{ type: 'unsubscribe', pollId: 12 }` — server removes socket from that room

**Server -> Client messages**

* `poll:update` — emitted to `poll:{pollId}` room when votes change. Payload:

  ```json
  {
    "type": "poll:update",
    "pollId": 12,
    "options": [
      { "id": 1, "text": "Red", "votesCount": 10 },
      { "id": 2, "text": "Blue", "votesCount": 5 }
    ]
  }
  ```

**When to broadcast?**

* After a `POST /api/polls/:pollId/vote` successfully persists a vote, compute the current counts and broadcast to room `poll:{pollId}`.

---

## Authentication

* The challenge doesn't require a full auth system, but the scaffolding should be present.
* Recommended: JWT-based authentication for protected endpoints (creating polls, voting).
* Store `passwordHash` (bcrypt) — never return it in API responses.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [PostgreSQL](https://www.postgresql.org/) (running locally or via Docker)
- Package manager: `npm`, `yarn`, or `pnpm`
- [Docker](https://www.docker.com/) (optional, for containerized development)

### Environment variables (.env)

```
DATABASE_URL=postgresql://user:password@localhost:5432/move37?schema=public
PORT=4000
JWT_SECRET=replace_with_secure_secret
```

### Install & Run

```bash
# install
npm install

# generate prisma client
npx prisma generate

# run migrations (see next section)
npx prisma migrate dev --name init

# start in dev
npm run dev
```

If you prefer Docker, include a `docker-compose.yml` with Postgres and start the app with appropriate env variables.

---

## Database Migrations & Seeding

### Migrate

```bash
npx prisma migrate dev --name init
```

### Seed (optional)

Create `prisma/seed.ts` to insert sample users, polls and votes. Then run:

```bash
npx prisma db seed
```

Sample seed steps include creating a couple of users, a sample poll with 3 options, and a few votes to simulate live data.

---

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Run tests with coverage
npm run test:coverage
```

### Test Scenarios

- ✅ Creating a poll with options
- ✅ Submitting a vote and asserting DB state
- ✅ WebSocket subscription -> cast vote -> receive `poll:update` event
- ✅ Error handling for invalid inputs
- ✅ Authentication and authorization tests

---

## Deployment Notes

* Use a managed Postgres (e.g., Heroku Postgres, Supabase, Neon) in production.
* Ensure the WebSocket server is deployed to a provider that supports sticky sessions or use socket.io with an adapter (Redis) to scale across instances.
* Store `JWT_SECRET` and `DATABASE_URL` in your deployment environment variables.

---

## Design Notes & Decisions

* **Explicit Vote model**: I modeled `Vote` as an explicit table to make auditing/vote-history easy.
* **One vote per user per poll**: Enforcement can be done either at DB-level or application-level. DB-level would require the `Vote` model to include `pollId` as part of a unique constraint with `userId`, but because `Vote` currently refers to `pollOptionId`, you would need to denormalize or run an index on `(userId, pollId)` (via a computed relation or triggers). Simpler and clearer: handle uniqueness in application logic (check and update previous vote).
* **Socket rooms**: Rooms scoped by `poll:{pollId}` to avoid broadcasting unneeded updates.

---

## 🔮 Future Improvements

- [ ] Rate limiting and abuse prevention on voting endpoints
- [ ] Allow users to change their vote (`PATCH /api/polls/:pollId/vote`)
- [ ] Real-time presence (who is viewing the poll)
- [ ] More robust permissioning (admins, moderators)
- [ ] Add optimistic UI support and WebSocket acknowledgements
- [ ] Implement API versioning
- [ ] Add request validation middleware
- [ ] Set up CI/CD pipeline
- [ ] Add OpenAPI/Swagger documentation

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Prisma](https://www.prisma.io/) for the amazing ORM
- [Socket.IO](https://socket.io/) for real-time communication
- The Express team for the awesome web framework

---

## Appendix: Example Curl Flows

Create user:

```bash
curl -X POST http://localhost:4000/api/users -H "Content-Type: application/json" -d \
'{"name":"Alice","email":"alice@example.com","password":"secret"}'
```

Create poll (assumes you pass an Authorization header `Bearer <token>`):

```bash
curl -X POST http://localhost:4000/api/polls -H "Content-Type: application/json" -H "Authorization: Bearer <token>" -d \
'{"question":"Which is best?","isPublished":true,"options":["Red","Blue","Green"]}'
```

Vote:

```bash
curl -X POST http://localhost:4000/api/polls/1/vote -H "Content-Type: application/json" -H "Authorization: Bearer <token>" -d \
'{"optionId":2}'
```

---

If you want, I can also:

* generate the starter project bootstrapping code (Express app, Prisma client, routers), or
* provide a complete `index.ts` + `wsServer.ts` + sample controllers for `polls` and `votes`.

Tell me which you'd like next and I’ll add it to the repo.
