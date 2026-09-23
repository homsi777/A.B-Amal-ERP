# PRODUCTION SAFETY RULES — NON-NEGOTIABLE

**Note:** this repository is deployed on the VPS under the folder name `ab-amal-erp` (remote `A.B-Amal-ERP.git`) — these rules apply to it under either name.

**Incident (2026-09-23):** during a clotex deployment, a command meant to copy build files into the nginx directory read its target path from a variable that came back empty. The command silently expanded to `rm -rf /*` and ran against the root of the live production server. System binaries were destroyed, SSH access was lost, and four production systems on that server (clotex, abooerp, ERPSystem, hameed-hliwi) went down with real financial data at risk. Recovery only worked because the hosting provider happened to have a same-day backup — no safeguard in this project prevented or limited the damage. The rules below exist to make sure this class of failure cannot happen again, on this project or any other.

## Rule 1: Never execute deletion commands on any remote server
Under no condition, no justification, no "safe" variant. This includes but is not limited to:
`rm` (any flags), `rmdir`, `find ... -delete`, `find ... -exec rm`, `shred`, `unlink`, `truncate`, `dd`, `mkfs`, `wipefs`, `rsync --delete`, `git clean`, `docker system prune` / `docker volume rm`, redirection that overwrites existing files (`> file`) on system or deployment paths, `DROP DATABASE`, `DROP TABLE`, `TRUNCATE`, `DELETE` without `WHERE`.
If something must be deleted on a server: write the exact command, explain why, and STOP. The project owner executes it manually. Never run it yourself.

## Rule 2: No production command without explicit approval
Before ANY command on a remote/production server, print the full literal command (with all variables already expanded to their real values) and wait for explicit approval. No approval, no execution.

## Rule 3: Never build destructive or file-system paths from variables or command substitution on a server
Paths must be written literally and absolutely.

## Rule 4: Every shell script must start with `set -euo pipefail`
Every variable used in a path must be guarded as `${VAR:?}`. Every `cd` must be written as: `cd /absolute/path || exit 1`.

## Rule 5: Deployments never clean a target by deleting it
Deploy into a NEW timestamped release directory, then switch a symlink. Old releases are removed only by the project owner, manually.

## Rule 6: Backup before any production change
Take a fresh `pg_dump` of every affected database, download it to the project owner's local machine, verify it with `pg_restore --list`, and report size and timestamp BEFORE any production change.

## Rule 7: Local deletions only inside the project workspace
Explicit literal paths only. Never `/`, `~`, `$HOME`, a drive root, or a wildcard at any root level.
