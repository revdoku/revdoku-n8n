# Revdoku for n8n

Community nodes for incoming email and private file storage. The package contains **Revdoku** actions, **Revdoku Trigger** for new email, and a **Revdoku API** credential.

Start with the [three importable workflow templates](templates/README.md): create an inbox, save email JSON, or back up original emails.

## Install from source

Use Node 22.16 or newer and an n8n installation that supports community nodes. This package has not been published to npm.

```sh
npm ci
npm test
npm run lint
npm pack
```

Install the resulting `n8n-nodes-revdoku-1.0.0.tgz` into your self-hosted n8n community-node directory (normally `~/.n8n/nodes`, create it first):

```sh
npm install /absolute/path/to/n8n-nodes-revdoku-1.0.0.tgz
```

Restart n8n, then search for Revdoku in the node selector. See n8n's [manual community-node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/manual-install/). Hosted n8n installations apply their own community-node availability rules.

## Connect and use

1. Create an API key in [Revdoku Account → Access](https://app.revdoku.com/account/access).
2. Add a Revdoku API credential in n8n. Enter the key and, optionally, the Account ID to use. The key's default account applies when that field is empty.
3. Add a Revdoku action or trigger and select the credential. Bucket, message and attachment IDs come from preceding API results or the dashboard.

| Resource | Operations |
| --- | --- |
| Account | Get status, get limits |
| Bucket | Create, get, list |
| Email | Get, list, set read/unread, delete, download original, download attachment |
| File | Get, list, upload, download, delete |

List operations support a limit or all results. Each result retains its n8n input-item link. Uploads accept n8n binary data or UTF-8 text, including empty text. Downloads create n8n binary data, with fresh temporary links obtained during execution. Deletions require confirmation.

## New-email trigger

Set Bucket ID and the polling schedule. Manual tests return the newest email without changing the saved cursor. In an active workflow, the trigger follows the API's arrival cursor, so delayed messages with older receipt dates are still detected.

By default, the trigger skips the existing inbox while establishing its starting position. Enable **Include Existing Emails** to process that backlog. Each poll reads at most 1,000 messages and resumes at the saved cursor on the next poll; a large initial inbox can require several polls before new-only processing starts. Do not use the activation warmup as a historical export.

The cursor is scoped to the credential, account and bucket. Changing any of those establishes a new starting position. A failed polling request leaves the previous cursor intact. n8n owns static-data persistence and workflow retries; downstream actions should tolerate a repeated email ID after recovery. See the [n8n static-data documentation](https://docs.n8n.io/code/cookbook/builtin/get-workflow-static-data/).

## Development checks

`npm test` compiles and loads both nodes and the credential, then exercises native-helper contracts for pagination, empty polls, backlog recovery, binary storage, item links, API errors and authentication boundaries. `npm run lint` uses the official n8n node validator. CI also checks the npm artifact contents.

No live n8n installation or Revdoku account is required for these checks. Before a registry release, install the tarball in the intended n8n version and test with an authorized account. Publishing to npm or a node catalog is a separate release action.
