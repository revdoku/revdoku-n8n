# Revdoku for n8n

Receive email, read attachments and manage private files in n8n workflows.

Available for **self-hosted n8n through source installation**. This package is not published to npm or available on n8n Cloud.

## Start

1. [Build and install the community nodes](USAGE.md#install-from-source), with instructions for local and Docker installations.
2. [Create an API key and connect](USAGE.md#connect-and-use).
3. Import a [workflow template](templates/README.md): create an mailbox, save email JSON or back up original emails.

[Operations and trigger behavior](USAGE.md) · [Revdoku API](https://revdoku.com/api.md)

## Develop

```sh
npm ci
npm test
npm run lint
npm pack
```

[Contribute](CONTRIBUTING.md) · [MIT license](LICENSE) · support@revdoku.com
