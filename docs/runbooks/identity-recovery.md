# Installation owner bootstrap and credential recovery

Production and demonstration installations use the same one-time owner setup. Create the organization first, then run the owner bootstrap from a trusted host. The command prompts without echo on an interactive terminal; for automation, redirect a protected password file to standard input. Never put a password in an argument or environment variable.

```sh
npm run identity:account -w @open-triage/api -- bootstrap-owner \
  --organization-id <organization-uuid> \
  --username <local-username> \
  --display-name <display-name> \
  --operator-id <change-or-incident-id>
```

The owner receives no role assignment. Ownership itself grants every registered capability, including administration, publishing, ordinary clinical documentation, and clinical demonstration tools. The legacy `--clinician` option is accepted for command compatibility but no longer changes access. A replay or concurrent second attempt fails without creating another user. Until bootstrap succeeds, ordinary role assignments remain ineffective and neither Admin nor clinical work is available.

Recover the current owner by immutable organization ownership, so a username rename cannot redirect the operation:

```sh
npm run identity:account -w @open-triage/api -- reset-owner \
  --organization-id <organization-uuid> \
  --operator-id <incident-id>
```

Recover any other local account only by its immutable application-user ID:

```sh
npm run identity:account -w @open-triage/api -- reset-user \
  --user-id <user-uuid> \
  --operator-id <incident-id>
```

Every reset replaces the verifier, requires a password change at next sign-in, and revokes active sessions atomically. `app_identity.operator_identity_event` records the command, immutable target, supplied operator ID, OS account, host, database time, and result. It is append-only and rejects secret-shaped audit fields. Command output contains identifiers and status only.

After any recovery, confirm the expected person changes the temporary password and review the event by immutable target. Treat an absent audit record as an operational monitoring incident; never include the temporary password in a ticket, shell history, log, or audit note.

## Additional superadmins

The installation keeps one accountable owner and may have multiple superadmins.
Superadmins can manage agencies and work across agency boundaries. They do not
replace the owner or gain the right to initiate an ownership transfer.

Create a superadmin using the operator database connection, with the same
secret-loading procedure as owner setup:

```sh
npm run identity:account -w @open-triage/api -- create-superadmin \
  --organization-id '<home-agency-uuid>' \
  --username 'installation.admin' \
  --display-name 'Installation administrator' \
  --operator-id '<operator-or-ticket-id>'
```

The password is read from a hidden terminal prompt or standard input, never a
command-line flag. It expires after 72 hours and must be changed at first login.
The home agency is normalized to its family root. Creation is transactional and
records the operator, host, and success or failure without recording passwords.
The API runtime database role cannot create superadmins.

Owner and superadmin usernames are case-insensitively unique across the entire
installation and cannot overlap an ordinary account's current or previously
reserved username in any family. Ordinary usernames are unique within their
organization family; independent families can each use the same username.
Renamed and disabled accounts retain their username reservations.

Use an agency's hostname to sign in as an ordinary user. The main-domain login
accepts only owners and superadmins. To reset a superadmin's password, use
`reset-user --user-id '<immutable-user-uuid>' --operator-id '<operator-or-ticket-id>'`
through the same CLI. Agency administrators cannot edit superadmin identities,
roles, or credentials.
