# Project

## Development

### Host-run setup

1. Copy the example environment file:

   ```sh
   cp .env.example .env
   ```

2. Start the development server:

   ```sh
   pnpm dev
   ```

#### Environment file loading

Host-run development commands load environment variables from `.env` explicitly
before configuration validation runs. The loader is wired into the `dev`
script so that a variable present only in `.env` reaches the process.

**Precedence:** values already present in the shell/process environment win
over values from the env file. The env file only fills in variables that are
not already set. This lets you override any value inline, for example:

```sh
DATABASE_URL=postgres://localhost:5432/dev pnpm dev
```

If a required value is absent from both the shell environment and the env
file, configuration validation fails with a clear error naming the missing
variable.

> Docker Compose uses its own `env_file` directive and is configured
> separately. The host-run env-file loading described here does not affect
> Compose behavior.

#### Local infrastructure host ports

`docker-compose.yml` publishes PostgreSQL and Redis on the host using
overridable variables. The defaults keep the standard mappings:

- `POSTGRES_HOST_PORT` defaults to `5432` (`5432:5432`)
- `REDIS_HOST_PORT` defaults to `6379` (`6379:6379`)

If those host ports are already in use, set alternate values without editing
the tracked Compose file:

```sh
POSTGRES_HOST_PORT=55432 REDIS_HOST_PORT=56379 docker compose up -d
```

Container-to-container addresses stay on the container ports, so the API and
worker continue to reach `postgres:5432` and `redis:6379` internally.

When running the app on the host against these containers, point the host-run
URLs at the published host ports. With the defaults:

```sh
DATABASE_URL=postgres://localhost:5432/dev
REDIS_URL=redis://localhost:6379
```

With the alternate host ports above:

```sh
DATABASE_URL=postgres://localhost:55432/dev
REDIS_URL=redis://localhost:56379
```
