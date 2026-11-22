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

### Testing locally

The test suite uses a separate test database (`fanilab_backend_test`) to avoid affecting development data.

#### Set up the test database

1. Start Postgres (if not already running):

   ```sh
   make db-up
   ```

2. Create the test database:

   ```sh
   make db-create-test
   ```

   This creates `fanilab_backend_test` with the same credentials as the development database.

3. Run the test suite:

   ```sh
   make test
   ```

   The test suite automatically runs migrations against the test database before tests.

**Note:** The test database is never automatically reset. If tests fail due to stale state, you can manually reset it by recreating it:

```sh
dropdb -h localhost -U fanilab fanilab_backend_test
make db-create-test
```

#### Local contributor checks

Before opening a pull request, run the same checks CI runs:

```sh
make format-check  # Check formatting (read-only)
make lint          # Run ESLint
make typecheck     # Type check
make test          # Run test suite
```

Or run all checks together:

```sh
make format-check && make lint && make typecheck && make test
```
