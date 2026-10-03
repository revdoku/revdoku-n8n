# Revdoku workflow templates

n8n supports reusable templates and [workflow JSON imports](https://docs.n8n.io/build/manage-workflows/export-and-import.md). These three files import directly into the editor. They use the Revdoku community nodes and contain no saved credentials or execution data.

## Import and connect

1. [Install the Revdoku nodes](../USAGE.md#install-from-source) in your n8n instance. These templates require node version 1 from `n8n-nodes-revdoku` 1.0.0 or newer.
2. Create a workflow. Open the upper-right **…** menu → **Import from File** and select one JSON file below.
3. Select your **Revdoku API** credential on every Revdoku node. Use the source account's credential for email nodes and a credential authorized for the destination account/bucket on upload nodes. Account ID belongs in the credential.
4. Replace each `REPLACE_WITH_…_BUCKET_ID` value. The other source bucket fields are expressions linked to **New email**, so configure its Bucket ID once.
5. Test the workflow manually, inspect the saved file, then activate the two polling workflows when ready. The import starts inactive. A manual trigger test samples the newest existing email; it can still write the downstream file.

## 1. Create an inbox and a welcome file

[Import 01-create-inbox.json](01-create-inbox.json)

**Run manually → Create inbox → Save welcome file**

Choose one account credential for both Revdoku nodes. Run once. The creation step returns the new bucket ID and receiving address; the upload step writes `welcome.txt` into that same bucket. The key needs bucket creation and file write permissions.

Each execution creates another inbox. If creation fails or times out, inspect the retained bucket or error details before executing again. Do not enable automatic retry on **Create inbox**.

## 2. Save received email as JSON, then mark it read

[Import 02-save-email-json.json](02-save-email-json.json)

**New email → Get email → Save email JSON → Mark email read**

Set the source bucket on **New email** and the destination bucket on **Save email JSON**. The workflow stores `email-json/<email-id>.json`, including `body_text`, `body_status` and attachment metadata. It marks the source email read only after saving succeeds. Source read/write and destination file write permissions are required.

The text can be empty, unavailable or truncated; `body_status` remains in the saved JSON. Attachment bytes are separate from this metadata.

## 3. Back up original email files

[Import 03-back-up-email.json](03-back-up-email.json)

**New email → Download original → Save EML file**

Set the source and destination buckets. **Download original** writes binary field `data`; **Save EML file** reads that same field and stores `email-backups/<email-id>.eml`. It retains the original MIME message, including its original attachments. Source read and destination file write permissions are required.

## Polling and retries

The polling templates check every minute and default to **Include Existing Emails = false**. The first poll establishes the starting cursor; a large inbox can need several polls. Enable Include Existing Emails before activation to copy the backlog instead. A manual test does not establish or advance the active workflow's cursor.

Paths use email IDs, so retried downstream runs target the same file. n8n owns retries and checkpoint persistence; repeated executions remain possible. See the [trigger behavior](../USAGE.md#new-email-trigger) before using the workflows for a historical export.
