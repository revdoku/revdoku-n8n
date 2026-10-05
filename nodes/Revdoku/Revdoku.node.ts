import { createHash } from "node:crypto";
import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";
import { properties } from "./descriptions";
import { httpsUrl, list, request } from "./transport";

export class Revdoku implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Revdoku",
    name: "revdoku",
    icon: { light: "file:revdoku.svg", dark: "file:revdoku.svg" },
    group: ["transform"],
    version: 1,
    usableAsTool: true,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: "Read incoming emails and manage private files",
    defaults: { name: "Revdoku" },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: "revdokuApi", required: true }],
    properties,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter("resource", i) as string;
        const operation = this.getNodeParameter("operation", i) as string;
        const id = (name: string) =>
          encodeURIComponent(this.getNodeParameter(name, i) as string);
        const reason = this.getNodeParameter("reason", i, "") as string;
        let result: IDataObject | IDataObject[];
        if (resource === "account") {
          result = await request.call(
            this,
            "GET",
            operation === "limits" ? "/account/limits" : "/status",
          );
        } else if (resource === "mailbox") {
          if (operation === "create") {
            const username = this.getNodeParameter(
              "emailUsername",
              i,
              "",
            ) as string;
            result = await request.call(this, "POST", "/mailboxes", {
              mailbox: {
                ...(username ? { email: { username } } : {}),
              },
              reason,
            });
          } else if (operation === "getMany") {
            const data = await request.call(this, "GET", "/mailboxes");
            result = data.mailboxes as IDataObject[];
          } else {
            result = await request.call(
              this,
              "GET",
              `/mailboxes/${id("mailboxId")}`,
              {
                include_email: this.getNodeParameter(
                  "includeEmail",
                  i,
                  false,
                ) as boolean,
              },
            );
          }
        } else {
          const mailboxPath = `/mailboxes/${id("mailboxId")}`;
          const collection = resource === "email" ? "emails" : "files";
          const path = `${mailboxPath}/${collection}`;
          if (operation === "getMany") {
            const returnAll = this.getNodeParameter(
              "returnAll",
              i,
              false,
            ) as boolean;
            const limit = returnAll
              ? 100
              : (this.getNodeParameter("limit", i, 50) as number);
            if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
              throw new NodeOperationError(
                this.getNode(),
                "Limit must be an integer between 1 and 10000",
                { itemIndex: i },
              );
            const filters =
              resource === "email"
                ? {
                    ...(this.getNodeParameter("filters", i, {}) as IDataObject),
                    order: "asc",
                  }
                : {};
            result = await list.call(
              this,
              path,
              collection,
              filters,
              returnAll,
              limit,
            );
          } else if (operation === "upload") {
            const filePath = this.getNodeParameter("path", i) as string;
            const binaryField = this.getNodeParameter(
              "inputBinaryField",
              i,
              "data",
            ) as string;
            const isBinary =
              this.getNodeParameter("uploadInput", i) === "binary";
            const bytes = isBinary
              ? await this.helpers.getBinaryDataBuffer(i, binaryField)
              : Buffer.from(
                  this.getNodeParameter("text", i, "") as string,
                  "utf8",
                );
            const contentType =
              (this.getNodeParameter("contentType", i, "") as string) ||
              (isBinary
                ? items[i].binary?.[binaryField]?.mimeType
                : "text/plain") ||
              "application/octet-stream";
            const filename = filePath.split("/").pop() || "file";
            const descriptor = await request.call(
              this,
              "POST",
              "/direct_uploads",
              {
                mailbox_id: this.getNodeParameter("mailboxId", i) as string,
                path: filePath,
                reason,
                blob: {
                  filename,
                  byte_size: bytes.length,
                  checksum: createHash("md5").update(bytes).digest("base64"),
                  sha256: createHash("sha256").update(bytes).digest("hex"),
                  content_type: contentType,
                  purpose: "mailbox_file",
                },
              },
            );
            if (descriptor.skipped && descriptor.file) {
              result = descriptor;
            } else {
              const upload = descriptor.direct_upload as IDataObject;
              if (!upload || !descriptor.signed_id)
                throw new NodeOperationError(
                  this.getNode(),
                  "Revdoku did not return an upload URL",
                  { itemIndex: i },
                );
              await this.helpers.httpRequest({
                method: "PUT",
                url: httpsUrl.call(this, upload.url),
                headers: upload.headers as Record<string, string>,
                body: bytes,
                json: false,
              });
              result = await request.call(this, "POST", path, {
                signed_blob_id: descriptor.signed_id,
                path: filePath,
                name: filename,
                role: "artifact",
                reason,
              });
            }
          } else {
            const itemId = resource === "email" ? id("emailId") : id("fileId");
            const itemPath = `${path}/${itemId}`;
            if (operation === "delete") {
              if (this.getNodeParameter("confirm", i, false) !== true)
                throw new NodeOperationError(
                  this.getNode(),
                  "Confirm deletion before running this operation",
                  { itemIndex: i },
                );
              result = await request.call(this, "DELETE", itemPath, { reason });
              if (resource === "email")
                result = {
                  id: this.getNodeParameter("emailId", i) as string,
                  deleted: true,
                };
            } else if (operation === "update") {
              result = await request.call(this, "PATCH", itemPath, {
                read: this.getNodeParameter("read", i) as boolean,
                reason,
              });
            } else if (operation.startsWith("download")) {
              let url: string;
              let metadata: IDataObject;
              if (resource === "email") {
                const suffix =
                  operation === "downloadAttachment"
                    ? `attachments/${id("attachmentId")}`
                    : "raw";
                const data = await request.call(
                  this,
                  "GET",
                  `${itemPath}/${suffix}`,
                );
                const download = data.download as IDataObject;
                if (!download || download.authentication !== "none")
                  throw new NodeOperationError(
                    this.getNode(),
                    "Invalid email download descriptor",
                    { itemIndex: i },
                  );
                url = httpsUrl.call(this, download.url);
                metadata = { ...download };
                delete metadata.url;
              } else {
                const data = await request.call(this, "GET", itemPath);
                const file = data.file as IDataObject;
                if (!file)
                  throw new NodeOperationError(
                    this.getNode(),
                    "File metadata is missing",
                    { itemIndex: i },
                  );
                const version = file.current_file_version as IDataObject;
                const link = await request.call(
                  this,
                  "GET",
                  `${itemPath}/download`,
                  { version_id: version?.id },
                  true,
                );
                url = httpsUrl.call(this, link.url);
                metadata = {
                  filename: file.basename || file.path,
                  content_type: version?.mime_type,
                };
              }
              const bytes = await this.helpers.httpRequest({
                method: "GET",
                url,
                encoding: "arraybuffer",
                json: false,
              });
              const binary = await this.helpers.prepareBinaryData(
                bytes as Buffer,
                metadata.filename as string,
                metadata.content_type as string,
              );
              const binaryField = this.getNodeParameter(
                "outputBinaryField",
                i,
                "data",
              ) as string;
              output.push({
                json: metadata,
                binary: { [binaryField]: binary },
                pairedItem: { item: i },
              });
              continue;
            } else {
              result = await request.call(this, "GET", itemPath);
            }
          }
        }
        for (const json of Array.isArray(result) ? result : [result])
          output.push({ json, pairedItem: { item: i } });
      } catch (error) {
        if (!this.continueOnFail())
          throw new NodeOperationError(this.getNode(), error as Error, {
            itemIndex: i,
          });
        output.push({
          json: {
            error:
              error instanceof Error ? error.message : "Revdoku request failed",
          },
          pairedItem: { item: i },
        });
      }
    }
    return [output];
  }
}
