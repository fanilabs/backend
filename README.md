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

## Handsoff notes

<!-- handsoff-issue-655 -->
- #655: Validate Grafana provisioning references before local startup
