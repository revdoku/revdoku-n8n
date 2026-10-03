const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Workflow, createRunExecutionData } = require("n8n-workflow");
const { Revdoku } = require("../dist/nodes/Revdoku/Revdoku.node");
const { RevdokuTrigger } = require("../dist/nodes/Revdoku/RevdokuTrigger.node");

const action = new Revdoku();
const trigger = new RevdokuTrigger();
const types = {
  "n8n-nodes-revdoku.revdoku": action,
  "n8n-nodes-revdoku.revdokuTrigger": trigger,
  "n8n-nodes-base.manualTrigger": {
    description: {
      name: "manualTrigger",
      version: 1,
      properties: [],
      inputs: [],
      outputs: ["main"],
    },
  },
};
const directory = path.join(__dirname, "../templates");
const templates = fs
  .readdirSync(directory)
  .filter((name) => name.endsWith(".json"))
  .sort();
const success = (data) => ({ statusCode: 200, body: { success: true, data } });
const emails = [
  {
    id: "eml_first",
    subject: "Résumé",
    body_text: null,
    body_status: "empty",
    attachments: [],
  },
  {
    id: "eml_second",
    subject: "Second message",
    body_text: "Hello, café",
    body_status: "complete",
    attachments: [],
  },
];

// Use n8n's Workflow and expression evaluator for the exact JSON being shipped.
// Only native HTTP/binary helpers are replaced; graph links and .item resolution are real.
async function executeTemplate(filename, options = {}) {
  const definition = JSON.parse(
    fs.readFileSync(path.join(directory, filename), "utf8"),
  );
  for (const node of definition.nodes) {
    for (const [name, value] of Object.entries(node.parameters)) {
      if (value === "REPLACE_WITH_SOURCE_BUCKET_ID")
        node.parameters[name] = "bkt_source";
      if (value === "REPLACE_WITH_DESTINATION_BUCKET_ID")
        node.parameters[name] = "bkt_destination";
    }
    if (node.type.startsWith("n8n-nodes-revdoku"))
      node.credentials = { revdokuApi: { id: "fixture-credential" } };
  }
  const workflow = new Workflow({
    ...definition,
    id: "fixture",
    nodeTypes: {
      getByNameAndVersion(name, version) {
        assert.equal(version, 1);
        assert.ok(types[name], `Unknown node ${name}`);
        return types[name];
      },
      getKnownTypes: () => ({}),
    },
  });
  const runData = createRunExecutionData();
  const calls = [];
  const uploads = new Map();
  const saved = [];
  const marked = [];
  let polls = 0;
  let items = [{ json: {} }];
  let previous;
  let current = definition.nodes[0].name;
  const visited = new Set();
  while (current) {
    assert.ok(!visited.has(current), "Cycle in example workflow");
    visited.add(current);
    const node = workflow.getNode(current);
    const source = previous
      ? { previousNode: previous, previousNodeOutput: 0, previousNodeRun: 0 }
      : null;
    const executeData = {
      node,
      data: { main: [items] },
      source: source ? { main: [source] } : null,
    };
    const context = {
      getInputData: () => items,
      getNode: () => node,
      getNodeParameter(name, index = 0, fallback) {
        const value = node.parameters[name] ?? fallback;
        return workflow.expression.getParameterValue(
          value,
          runData,
          0,
          index,
          node.name,
          items,
          "trigger",
          {},
          executeData,
        );
      },
      getCredentials: async () => ({
        apiKey: "fixture-key",
        accountId:
          node.parameters.bucketId === "bkt_destination"
            ? "acct_destination"
            : "acct_source",
      }),
      getMode: () => "trigger",
      getWorkflowStaticData: (kind) => workflow.getStaticData(kind, node),
      continueOnFail: () => false,
      helpers: {
        async httpRequestWithAuthentication(credential, request) {
          assert.equal(credential, "revdokuApi");
          calls.push({ node: node.name, ...request });
          const endpoint = new URL(request.url).pathname;
          const account =
            request.method === "GET"
              ? request.qs?.account_id
              : request.body.account_id;
          assert.equal(
            account,
            node.parameters.bucketId === "bkt_destination"
              ? "acct_destination"
              : "acct_source",
          );
          if (endpoint === "/v1/buckets" && request.method === "POST") {
            return success({
              bucket: {
                id: "bkt_created",
                email: { address: "created@revdokumail.com" },
              },
            });
          }
          if (endpoint.endsWith("/emails")) {
            polls += 1;
            return success({
              emails: polls === 1 ? [] : emails,
              pagination: { has_more: false, next_cursor: `cursor-${polls}` },
            });
          }
          const match = endpoint.match(/\/emails\/(eml_[^/]+)(\/raw)?$/);
          if (match) {
            assert.ok(endpoint.startsWith("/v1/buckets/bkt_source/"), endpoint);
            const email = emails.find((item) => item.id === match[1]);
            assert.ok(email, endpoint);
            if (request.method === "PATCH") {
              assert.equal(request.body.read, true);
              marked.push(email.id);
              return success({ email: { ...email, read: true } });
            }
            if (match[2])
              return success({
                download: {
                  authentication: "none",
                  url: `https://storage.example.test/${email.id}`,
                  filename: `${email.id}.eml`,
                  content_type: "message/rfc822",
                },
              });
            return success({ email });
          }
          if (endpoint === "/v1/direct_uploads") {
            if (options.failUpload)
              return {
                statusCode: 503,
                body: {
                  success: false,
                  error: {
                    code: "STORAGE_UNAVAILABLE",
                    message: "Fixture failure",
                  },
                },
              };
            const id = `upload-${uploads.size}`;
            uploads.set(id, { ...request.body });
            return success({
              signed_id: id,
              direct_upload: {
                url: `https://storage.example.test/${id}`,
                headers: { "Content-Type": request.body.blob.content_type },
              },
            });
          }
          if (endpoint.endsWith("/files") && request.method === "POST") {
            const upload = uploads.get(request.body.signed_blob_id);
            assert.ok(upload?.bytes, "The upload must happen before attaching");
            assert.equal(request.body.path, upload.path);
            saved.push(upload);
            return success({
              file: { id: `df_${saved.length}`, path: upload.path },
            });
          }
          assert.fail(`Unexpected request: ${request.method} ${endpoint}`);
        },
        async httpRequest(request) {
          assert.ok(
            !request.headers?.Authorization,
            "API token sent to file storage",
          );
          const id = new URL(request.url).pathname.slice(1);
          if (request.method === "PUT") {
            const upload = uploads.get(id);
            assert.ok(upload);
            upload.bytes = request.body;
            assert.equal(upload.blob.byte_size, request.body.length);
            return "";
          }
          return Buffer.from(`EML:${id}\0`);
        },
        async prepareBinaryData(bytes, fileName, mimeType) {
          return { data: bytes.toString("base64"), fileName, mimeType };
        },
        async getBinaryDataBuffer(index, field) {
          assert.equal(field, "data");
          return Buffer.from(items[index].binary[field].data, "base64");
        },
      },
    };
    let result;
    try {
      if (node.type.endsWith(".manualTrigger")) result = [items];
      else if (node.type.endsWith(".revdokuTrigger")) {
        assert.equal(
          await trigger.poll.call(context),
          null,
          "Default activation skips history",
        );
        result = await trigger.poll.call(context);
      } else result = await action.execute.call(context);
    } catch (error) {
      error.exampleState = { calls, saved, marked };
      throw error;
    }
    items = result[0];
    runData.resultData.runData[node.name] = [
      {
        startTime: Date.now(),
        executionIndex: visited.size - 1,
        executionTime: 1,
        executionStatus: "success",
        source: source ? [source] : [],
        data: { main: [items] },
      },
    ];
    previous = current;
    current = definition.connections[current]?.main?.[0]?.[0]?.node;
  }
  assert.equal(
    visited.size,
    definition.nodes.length,
    "Unconnected example node",
  );
  return { calls, saved, marked, items };
}

test("three importable workflows have connected nodes, supported operations and no saved secrets", () => {
  assert.equal(templates.length, 3);
  for (const filename of templates) {
    const definition = JSON.parse(
      fs.readFileSync(path.join(directory, filename), "utf8"),
    );
    assert.equal(definition.active, false);
    assert.deepEqual(definition.pinData, {});
    assert.equal(
      new Set(definition.nodes.map((node) => node.id)).size,
      definition.nodes.length,
    );
    for (const node of definition.nodes) {
      assert.ok(types[node.type]);
      assert.equal(node.typeVersion, 1);
      assert.ok(!node.credentials);
      assert.ok(!node.retryOnFail);
      if (node.type.endsWith(".revdoku")) {
        const operation = action.description.properties.find(
          (field) =>
            field.name === "operation" &&
            field.displayOptions.show.resource.includes(
              node.parameters.resource,
            ),
        );
        assert.ok(
          operation.options.some(
            (option) => option.value === node.parameters.operation,
          ),
        );
      }
      if (node.type.endsWith(".revdokuTrigger")) {
        assert.deepEqual(node.parameters.pollTimes, {
          item: [{ mode: "everyMinute" }],
        });
        assert.equal(node.parameters.includeExisting, false);
      }
    }
  }
});

test("create workflow uploads into the bucket returned by creation", async () => {
  const { saved } = await executeTemplate(templates[0]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].bucket_id, "bkt_created");
  assert.equal(saved[0].path, "welcome.txt");
});

test("JSON workflow preserves null bodies and each email ID across all linked items", async () => {
  const { saved, marked } = await executeTemplate(templates[1]);
  assert.deepEqual(
    saved.map((item) => item.path),
    ["email-json/eml_first.json", "email-json/eml_second.json"],
  );
  assert.ok(
    saved.every(
      (item) =>
        item.bucket_id === "bkt_destination" &&
        item.account_id === "acct_destination",
    ),
  );
  assert.deepEqual(
    saved.map((item) => JSON.parse(item.bytes.toString())),
    emails,
  );
  assert.deepEqual(marked, ["eml_first", "eml_second"]);
});

test("EML workflow transfers binary data and preserves IDs through download outputs", async () => {
  const { saved, marked } = await executeTemplate(templates[2]);
  assert.deepEqual(
    saved.map((item) => item.path),
    ["email-backups/eml_first.eml", "email-backups/eml_second.eml"],
  );
  assert.deepEqual(
    saved.map((item) => item.bytes.toString()),
    ["EML:eml_first\0", "EML:eml_second\0"],
  );
  assert.deepEqual(marked, []);
});

test("failed file upload stops the JSON workflow before marking email read", async () => {
  await assert.rejects(
    executeTemplate(templates[1], { failUpload: true }),
    (error) => {
      assert.deepEqual(error.exampleState.marked, []);
      assert.deepEqual(error.exampleState.saved, []);
      return true;
    },
  );
});
