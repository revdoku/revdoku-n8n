# Revdoku for n8n

Receive email, read attachments and manage private files in n8n workflows.

## Start

1. [Build and install the community nodes](USAGE.md#install-from-source) using Node 22.16+.
2. Add a **Revdoku API** credential with your API key and optional Account ID.
3. Import a [workflow template](templates/README.md): create an inbox, save email JSON or back up original emails.

[Operations and trigger behavior](USAGE.md) · [Revdoku API](https://revdoku.com/api.md)

## Develop

```sh
npm ci
npm test
npm run lint
npm pack
```

[Contribute](CONTRIBUTING.md) · [MIT license](LICENSE) · support@revdoku.com
