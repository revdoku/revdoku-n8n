# Revdoku for n8n

Community nodes for incoming email and private file storage. The package contains **Revdoku** actions, **Revdoku Trigger** for new email, and a **Revdoku API** credential.

Start with the [three importable workflow templates](templates/README.md): create an mailbox, save email JSON, or back up original emails.

## Install from source

Use Node 22.16 or newer to build the package, Git, npm, and a self-hosted n8n installation that permits community nodes. This package has not been published to npm and cannot be installed on n8n Cloud. n8n Cloud requires verified community nodes; see [n8n installation options](https://docs.n8n.io/integrations/community-nodes/installation-and-management).

Tarball installation and node discovery were verified with the official n8n **2.41.6** Docker image.

### Build the package

```sh
git clone --depth 1 https://github.com/revdoku/revdoku-n8n.git
cd revdoku-n8n
npm ci --ignore-scripts
npm pack
package_file="$PWD/n8n-nodes-revdoku-1.0.0.tgz"
```

`npm pack` builds the nodes and creates the tarball. Use `--ignore-scripts` for dependency and tarball installation; the compiled nodes need no install scripts. Keep the resulting file for the next step; it contains the compiled nodes and templates.

### Install into local n8n

Run as the same operating-system user that runs n8n. For the default data directory:

```sh
mkdir -p "$HOME/.n8n/nodes"
cd "$HOME/.n8n/nodes"
npm install --ignore-scripts "$package_file"
```

If your instance uses a custom n8n data directory, use its `nodes` subdirectory. Restart n8n using your normal process manager, then search for **Revdoku** in the node selector.

### Install into Docker n8n

For the standard n8n image, replace `my-n8n` with your existing container's name. Its `/home/node/.n8n` directory should use a persistent volume:

```sh
docker cp "$package_file" my-n8n:/tmp/revdoku.tgz
docker exec --user node my-n8n sh -c 'mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && npm install --ignore-scripts /tmp/revdoku.tgz'
docker restart my-n8n
```

Search for **Revdoku** after restart. If it is absent, check that community nodes are enabled and that installation used the same persistent data directory as the running instance. In queue mode, install the same package on every worker that executes these workflows. See [n8n manual installation](https://docs.n8n.io/integrations/community-nodes/installation-and-management/manual-installation).

## Connect and use

1. [Sign up](https://app.revdoku.com/users/sign_up) or sign in, then create an API key in [Revdoku Account → Access](https://app.revdoku.com/account/access). Signup creates a starter mailbox.
2. Add a Revdoku API credential in n8n. Enter the key and, optionally, the Account ID to use. The key's default account applies when that field is empty.
3. Add a **Revdoku** action with **Resource = Mailbox**, **Operation = Get Many** and select the credential. Run it and copy the desired mailbox's `id` (`bkt_...`). A mailbox is an mailbox with private file storage.
4. Use that Mailbox ID on a **Revdoku Trigger**. Send a test email with a small attachment from your normal email app to its dashboard receiving address, then test the trigger. The returned `id` (`eml_...`) is the Email ID for subsequent steps.
5. Add **Email → Get** with the same Mailbox ID and the trigger's Email ID. It returns the message at `$json.email`, including `body_text`, `body_status` and `attachments`. For an attachment download, use one entry's `attachments[].id` (`df_...`).

Read access covers listing/reading mail and downloads. Marking mail read and uploading require mailbox write access. Creating a mailbox requires account-wide admin access; deleting email requires mailbox admin. Set Account ID in the credential when selecting another granted account; discover IDs with the [account list API](https://revdoku.com/api.md#accounts). A dashboard account switch does not change this credential.

| Resource | Operations |
| --- | --- |
| Account | Get status, get limits |
| Mailbox | Create, get, list |
| Email | Get, list, set read/unread, delete, download original, download attachment |
| File | Get, list, upload, download, delete |

List operations support a limit or all results. Each result retains its n8n input-item link. Uploads accept n8n binary data or UTF-8 text, including empty text. Downloads create n8n binary data, with fresh temporary links obtained during execution. Deletions require confirmation.

Downloads put file bytes in binary field **data** by default. Map that field into the next node's binary input; `attachments` from Get Email contains metadata only. Reading or downloading leaves the message's shared read status unchanged. **Email → Set Read Status** changes it separately. [Compare SDKs, CLI and MCP](https://github.com/revdoku/revdoku/blob/main/guides/api-packages.md).

## New-email trigger

Set Mailbox ID and the polling schedule. Manual tests return the newest email without changing the saved cursor. In an active workflow, the trigger follows the API's arrival cursor, so delayed messages with older receipt dates are still detected.

By default, the trigger skips the existing mailbox while establishing its starting position. Enable **Include Existing Emails** to process that backlog. Each poll reads at most 1,000 messages and resumes at the saved cursor on the next poll; a large initial mailbox can require several polls before new-only processing starts. Do not use the activation warmup as a historical export.

The cursor is scoped to the credential, account and mailbox. Changing any of those establishes a new starting position. A failed polling request leaves the previous cursor intact. n8n owns static-data persistence and workflow retries; downstream actions should tolerate a repeated email ID after recovery. See the [n8n static-data documentation](https://docs.n8n.io/code/cookbook/builtin/get-workflow-static-data/).

## Development checks

`npm test` compiles and loads both nodes and the credential, then exercises native-helper contracts for pagination, empty polls, backlog recovery, binary storage, item links, API errors and authentication boundaries. `npm run lint` uses the official n8n node validator. CI also checks the npm artifact contents.

No live n8n installation or Revdoku account is required for these checks. Before a registry release, install the tarball in the intended n8n version and test with an authorized account. Publishing to npm or a node catalog is a separate release action.
