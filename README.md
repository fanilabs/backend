# Project

## Development

### Package manager

The `packageManager` field in `package.json` is the authoritative source for
the pnpm version contributors must use. CI selects the same release, so a
fresh checkout should install with that exact version.

The `engines` range (for example `pnpm >=9`) is only a minimum compatibility
range — it is not the recommended or tested toolchain. Do not interpret it as
the version to install.

Select the pinned release with Corepack (this does not change any dependency
versions):

```sh
corepack prepare pnpm@10.33.0 --activate
```

Verify the active version matches the pin before installing:

```sh
pnpm --version   # must print 10.33.0
pnpm install --frozen-lockfile
```

When the `packageManager` pin changes, update the version in the
`corepack prepare` command above to match it, then re-run the verification
step.

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
