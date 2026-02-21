---
summary: "Use secret provider references instead of plaintext keys in config"
read_when:
  - Migrating API keys/tokens out of openclaw.json
  - Setting up env, keyring, 1Password, or cloud secret managers
title: "Secrets providers"
---

# Secrets providers

Use provider references in config values instead of putting plaintext secrets directly into `openclaw.json`.

## Why use provider references

- Reduces accidental secret leaks in git, screenshots, and logs
- Supports secret rotation without editing large config blocks
- Lets each environment use its own secret source

Typical pattern:

```json5
{
  models: {
    providers: {
      openai: {
        apiKey: "${env:OPENAI_API_KEY}",
      },
    },
  },
}
```

## Supported reference formats

### Environment provider

Use `${env:NAME}` to read from process environment.

```json5
{
  models: {
    providers: {
      anthropic: { apiKey: "${env:ANTHROPIC_API_KEY}" },
    },
  },
}
```

Notes:

- Missing variables fail fast during config load.
- Keep env values out of shell history (`export ...` in shell profile or service env files).

### Keyring provider

Use `${keyring:NAME}` to load from OS keychain/secret service.

```json5
{
  models: {
    providers: {
      openrouter: { apiKey: "${keyring:openrouter-api-key}" },
    },
  },
}
```

#### macOS (`security`) examples

Store a secret (service `openclaw`, account `openrouter-api-key`):

```bash
security add-generic-password \
  -a "openrouter-api-key" \
  -s "openclaw" \
  -w "sk-or-..." \
  ~/Library/Keychains/openclaw.keychain-db
```

Read it back for verification:

```bash
security find-generic-password \
  -a "openrouter-api-key" \
  -s "openclaw" \
  -w \
  ~/Library/Keychains/openclaw.keychain-db
```

If the keychain is locked, unlock first:

```bash
security unlock-keychain ~/Library/Keychains/openclaw.keychain-db
```

### 1Password provider

Use `op://vault/item/field` references.

```json5
{
  models: {
    providers: {
      openai: { apiKey: "op://Engineering/OpenAI API Key/credential" },
    },
  },
}
```

For local usage:

- Install and sign in with [1Password CLI](https://developer.1password.com/docs/cli/get-started/).
- Ensure `op` can access the referenced vault/item/field.

For CI/automation:

- Prefer a 1Password service account token with least privilege.
- Inject token as CI secret (for example `OP_SERVICE_ACCOUNT_TOKEN`).
- Avoid interactive sign-in in headless environments.

See:

- [1Password service accounts](https://developer.1password.com/docs/service-accounts/)
- [Load secrets into CI/CD](https://developer.1password.com/docs/ci-cd/)

### Cloud providers

When using managed secret stores, keep provider IAM scoped per environment/app.

- **Google Secret Manager (GCP):** [Quickstart](https://cloud.google.com/secret-manager/docs)
- **AWS Secrets Manager:** [User Guide](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)
- **Azure Key Vault (Secrets):** [Overview](https://learn.microsoft.com/azure/key-vault/secrets/)
- **HashiCorp Vault:** [KV secrets engine](https://developer.hashicorp.com/vault/docs/secrets/kv)

## Migration playbook (plaintext → provider refs)

1. **Inventory secret-bearing fields**
   - API keys (`apiKey`), tokens (`token`, `password`), webhook secrets, etc.
2. **Pick provider per environment**
   - Local dev: `${env:...}` or `${keyring:...}`
   - Team/shared infra: cloud secret manager or Vault
   - Existing 1Password org workflow: `op://...`
3. **Create secrets in provider**
   - Add entries and confirm access with provider CLI before config changes.
4. **Replace plaintext in config**
   - Swap values to provider refs (`${env:...}`, `${keyring:...}`, `op://...`).
5. **Restart and validate**
   - `openclaw gateway restart`
   - `openclaw gateway status`
   - Verify a known provider call succeeds (for example model request).
6. **Rotate old exposed keys**
   - Treat any previously committed/plaintext key as compromised.

## Troubleshooting

### Missing env var / unresolved reference

- Confirm variable exists in service runtime environment (not just your current shell).
- If using supervised service, check launchd/systemd environment source.
- For `.env` usage, verify file path and process working directory.

### Keychain/keyring access denied

- macOS: unlock keychain and verify ACL prompts were accepted.
- Linux: ensure secret service daemon is available and session is unlocked.
- Re-test lookup using native CLI (`security` or `secret-tool`) before restarting OpenClaw.

### 1Password resolution fails

- Check `op whoami` and vault permissions.
- Validate the exact reference path (`op://vault/item/field`) with `op read`.
- In CI, verify the service account token is present and not expired.

### Rotation and stale credentials

- Rotate secrets at the provider, then restart/reload if your deployment does not auto-refresh.
- Keep old and new credential overlap windows when provider allows staged rollout.
- If auth errors start after rotation, confirm the updated secret version is what runtime can access.

## Security notes

- Never paste real secrets into docs, issues, or chat logs.
- Use least-privilege IAM/scopes for every secret backend.
- Separate dev/staging/prod secret namespaces.
- Audit access logs where available (cloud managers, 1Password, Vault).

---

Related:

- [Gateway Configuration](/gateway/configuration)
- [Environment](/help/environment)
- [Gateway security](/gateway/security)
