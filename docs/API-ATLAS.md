# See and test your service APIs

Open **GitHub Actions** and import the repositories you want to compare. Choose a workflow in each lane. Then open **APIs & contracts** and select **Scan repository APIs**. Private repositories use the protected GitHub sign-in entered in GitHub Actions for this app session.

The scan reads the imported commits and your local source drafts. It never executes repository code. Each service shows its workflow context, endpoints and outgoing requests. Select an orange connection or a repository/service box to open its speech-bubble panel. Dashed connections need more source information before LVX can identify their provider. API arrows describe service calls, independently of the jobs in a CI workflow.

The offline repository examples include illustrative API descriptions. Their example addresses are not running services. Replace those addresses with your own test environment before running requests.

## Work on one connection

The speech bubble lists only endpoints relevant to the selected connection or section. A matched request shows its particular operation; a configured service destination shows its provider's declared endpoints. An arrow from a repository to an API description shows only that description's endpoints, even when the repository has several APIs. Page search and service filters do not broaden this scope.

Choose an endpoint inside the bubble, then create an API or contract test, review imported expectations or add its saved tests to a workflow. Expand **Connection source evidence** to inspect the declarations behind the arrow. A configured default can change at runtime and does not prove which operations a caller uses.

An unmatched external destination shows its source and explains the missing provider. A literal HTTP request offers **Review this request as a test** with its original method and URL. Configured URLs without an HTTP operation cannot invent an endpoint or a contract. Review the destination and expectations before saving or running.

The close button or Escape dismisses the panel and returns focus to its graph control. Unsaved edits ask before being discarded. You can close a panel while a saved test runs; the run continues and its results remain in the test list. **Browse all endpoints** gives a list alternative to the graph, including APIs with no outgoing connections.

The bubble stays in place while you scroll the dashboard. Its pointer stretches to the same selected point on the graph, including when you scroll inside the graph. If that point is off-screen or behind the panel, LVX hides the pointer and offers **Show selected connection** instead of pointing at unrelated content.

## Create tests with AI

Open a connection and select its **AI assistance** tab. The provider dropdown groups **Subscription / native login**, **API keys** and **Saved agents**. Native tools (Codex, Claude Code or Gemini) use their own login and configured tool location. Existing saved API agents remain available. **Manage saved agents / native tools** opens the agent board; **Refresh providers** reloads its saved choices.

Under **API keys**, choose OpenAI, Anthropic / Claude, Google Gemini, or an OpenAI-compatible endpoint. Enter your provider's model ID, API key and a positive output token limit, then choose **Save API provider**. A compatible provider also needs its full chat completions endpoint. Each provider has one configuration per project. Keys use the desktop's encrypted credential store; provider choices contain no keys or secret references. Saving does not contact the provider. Generation uses the API account's billing. **Edit API settings** changes the model or key; leaving the key empty keeps the saved credential. Model availability depends on your API account.

Choose **Selected endpoint** or **This connection / section**, describe the checks you want, and select **Generate test proposals**. LVX sends endpoint definitions, response schemas and source evidence for that scope. It uses a fresh authoring turn, keeping ordinary board conversations separate. The structured task uses its own authoring instructions; the selected provider's authentication, model and relevant transport settings are reused. Codex authoring uses read-only mode; other native tools retain their own provider permissions.

Generated tests appear under the green **AI response & suggestions** header in the connection bubble and the project-wide proposal library below the map. This distinct surface contains AI suggestions and provider/model attribution. App status messages stay outside it. Suggestions are pending proposals, not runnable tests. Each shows the proposed request, expectations, rationale, provider and source scope. Expand **Reviewed AI suggestions** to revisit accepted and rejected output for this connection.

- **Inspect** the generated definition and assumptions by expanding its details.
- **Accept test** adds a valid proposal to **All API & contract tests** without running it.
- **Review and edit** opens the existing request/contract editor. Choose **Accept reviewed AI test** to apply your changes and accept it.
- **Reject** keeps a reviewed record of the proposal and adds no runnable test.

Invalid proposals show their validation error and cannot be accepted directly. Edited proposals must still match an operation in the original connection, use a resolved HTTP URL and pass the normal request/schema checks. If the connection source changed, generate a new proposal from the current map. Accepted and rejected decisions remain inspectable after restarting. Cancellation or a failed/incomplete model response does not import partial runnable tests. Use **Run** explicitly when you are ready to contact the API.

## Find all saved tests

**All API & contract tests** at the bottom of the page shows every saved API and contract definition in the project. It includes tests created in LVX, reviewed Postman/Pact imports and retained tests whose endpoints are outside the current scan. Selecting a connection, searching endpoints or changing the service filter does not hide saved tests in this list.

Use **Run**, **Edit** or **Delete** beside a test. Edit opens that test's own endpoint panel. The list shows its origin, request, expected result, latest result and expandable run evidence. Unreviewed repository requests remain in their import sections until you review and save them; arbitrary code test suites stay in the repository editor and Test suites.

## Create a repeatable check

Choose **API tests** to check HTTP status, response text, headers and response time. Choose **Contract tests** to check a JSON response against a schema. OpenAPI response schemas fill in the contract editor automatically. Replace every URL placeholder with a test value, review the request method, headers and body, then choose **Save and apply test**.

**Run** executes one saved test. **Run endpoint tests** executes both kinds for the selected endpoint. **Run all saved tests** runs the complete saved API set, including retained tests outside the latest scan. **Stop current run** cancels an active request. Each test has its own positive timeout.

Results distinguish **PASSED**, **FAILED**, **ERROR** and **CANCELLED**. Expand a result to inspect assertions, schema violations, response data and previous runs. Editing a test marks older results **CHANGED SINCE RUN**. An unsupported schema cannot be saved as a valid contract. Test addresses are contacted only when you run a test.

Tests and evidence live in the selected project's existing SQLite storage. Saves use revision checks so another window cannot silently overwrite your changes. Request credentials use the desktop's protected credential store. Portable JSON saves must use the project's mandatory private save directory; this feature does not create separate JSON exports.

## Reuse existing repository tests

The import section shows Postman and Pact source evidence. Review an executable template before saving it as a local test. Requests without a matched endpoint are listed separately. Saved tests whose endpoints disappear during a rescan remain available below the map.

- **Postman:** raw HTTP requests, collection variables, query strings and headers become request templates. Scripts, inherited setup, authentication schemes and unsupported body modes remain visible with an explanation. They need conversion or their original runtime; LVX does not silently ignore their assertions and call the original test passed.
- **Pact:** simple HTTP examples can replay exact JSON bodies, query parameters and response headers. Provider states, matching rules, generators, V4/plugins, messaging, text and empty-body interactions need native Pact verification. Passing an exact HTTP replay does not certify Pact compatibility or publish a provider verification result.

The original files and unsupported expectations stay inspectable. Arbitrary test source remains available in the repository editor.

## Workflows and results

**Add endpoint tests to workflow** creates native API and contract nodes in a saved visual workflow. It opens that workflow for you. Each node contains a copy of the saved test, so the workflow remains repeatable when the API map changes. The node editor labels this copy explicitly and lets you edit its request and contract. Save the graph to retain those changes. You can return to the original endpoint from its node editor.

Repository workflow lanes expose the same endpoint links. **Workflows** has an **APIs & contracts** shortcut. **Results** includes endpoint runs and workflow-copy evidence, with links back to endpoint tests. The reporting dashboard also receives directly run API test results through its existing execution history.

## What discovery can prove

OpenAPI/Swagger descriptions declare available endpoints. Literal Node/Python routes and HTTP calls provide static source evidence. A unique method, URL origin and path match produces a service connection. Dynamic calls, mounted router prefixes, proxies, runtime service discovery and other language/framework route conventions may be missing. A missing edge does not prove that two services are unrelated. Scans show parser errors and skipped files instead of claiming complete coverage.

The runner supports GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS. Unsupported operations are reported. Schemas use JSON Schema draft-07 or 2020-12, with supported OpenAPI nullable conversion. References resolve only inside the scanned repository snapshot. Missing, remote and local filesystem references are refused. Validation runs in a worker with memory and time limits.

## Open-source foundations

LVX integrates [Swagger Parser](https://github.com/APIDevTools/swagger-parser) for OpenAPI parsing and safe repository-only reference resolution, [Ajv](https://github.com/ajv-validator/ajv) and [ajv-formats](https://github.com/ajv-validator/ajv-formats) for JSON Schema assertions, and the existing [TypeScript parser](https://github.com/microsoft/TypeScript) for JavaScript/TypeScript source calls. Dependency versions are pinned in package.json and package-lock.json. Their licenses ship in assets/licenses and THIRD_PARTY_NOTICES.md.

Import semantics were checked against the [Postman collection schema](https://schema.postman.com/collection/json/v2.1.0/draft-04/collection.json), [Swagger Parser API](https://apidevtools.com/swagger-parser/swagger-parser.html) and [Pact matching rules](https://docs.pact.io/implementation_guides/rust/pact_matching). [Pact JS](https://github.com/pact-foundation/pact-js) informed the distinction between replaying an example and full consumer/provider verification; its native verifier is not bundled in this feature.
