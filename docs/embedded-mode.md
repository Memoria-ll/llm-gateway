# Embedded Manifest mode

Set `MANIFEST_MODE=embedded` when this server is bundled inside a desktop application.
The mode is intended for a single local user and requires the application and its
PostgreSQL process to stay on the same machine.

This setting is implemented by this fork; setting it on an unmodified upstream
checkout has no effect. The fork baseline is upstream commit
`3304b52c3e2dac94b83c29b229730310bfa81dea`; keep the upstream remote and build
release packages from a reviewed, fixed fork commit.

Embedded mode creates a generic internal identity in the local Better Auth database
after its schema is initialized. The browser receives a local session automatically.
Local management API requests need neither a login nor an `X-API-Key` header.
Registration, login, password reset, admin setup, account and CLI pages/APIs,
discovery surveys, billing upgrade, remote MCP, Sentry, GitHub star lookups,
Manifest telemetry, and update checks are disabled. Startup refreshes for third-party
model and pricing catalogs are also skipped. Provider OAuth and API-key flows remain
available when the user starts them.

The HTTP server always binds to `127.0.0.1`, regardless of `BIND_ADDRESS`. The
`DATABASE_URL` host must be `localhost`, `127.0.0.0/8`, or `::1`; the bundled
PostgreSQL process must itself listen only on loopback. Configure the desktop
runtime to start both processes locally and keep their data under the application's
local data directory. The runtime must also generate and persist the existing
`BETTER_AUTH_SECRET` (at least 32 characters) and any provider-credential encryption
key locally; users do not create a Manifest account or profile.

Do not download an upstream source tree and patch it during packaging. Include the
root `LICENSE` in installers and ZIP archives, and preserve third-party `LICENSE`,
`COPYING`, and `NOTICE` files from runtime dependencies. The Docker image built from
this fork includes the root license and keeps those dependency notices.
