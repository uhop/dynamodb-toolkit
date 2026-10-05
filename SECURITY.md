# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, pull requests, or discussions.**

Report privately through GitHub's **[Private Vulnerability Reporting](https://github.com/uhop/dynamodb-toolkit/security/advisories/new)**
(the "Report a vulnerability" button under the repository's **Security** tab). This opens a
confidential advisory visible only to the maintainers and you.

If GitHub reporting is unavailable to you, email the maintainer at
**eugene.lazutkin@gmail.com** with `SECURITY` in the subject line. Please do not disclose
details publicly until a fix is released.

When reporting, please include:

- the affected version(s) and runtime,
- the component and its options &mdash; which entry point (an `Adapter` method, a REST route, an
  exported helper), which adapter options, and which REST policy,
- a description of the issue and its impact,
- steps to reproduce: a request or a call through a documented entry point, with the requests
  sent to DynamoDB or the observed value,
- any suggested remediation.

## Scope

`dynamodb-toolkit` builds DynamoDB requests and sends them through the AWS SDK client your code
passes to an `Adapter`, under your credentials. It opens no listening socket and spawns no
processes. The HTTP modules (`handler`, `express`, `koa`, `fetch`, `lambda`) translate requests
that your server, framework, or Lambda runtime has already accepted. The CLI
(`bin/dynamodb-toolkit.js`) imports the adapter module at the path you give it and calls DynamoDB
through that adapter's client.

Input reaches the toolkit at three levels of trust:

- **Request input is untrusted.** The REST layer parses the URLs, query strings, and bodies your
  service's clients send, and it clamps them: page sizes, offsets, key lists, and request bodies
  have caps, and cursor tokens are validated as attacker-controlled.
- **Programmatic callers are trusted.** Arguments your own code passes to `Adapter` methods and
  exported helpers are taken as given; the TypeScript types are the contract.
- **Adapter definitions are trusted.** The schema, hooks, REST policy, and any expression strings
  you write into `params` are authored by the developer at design time.

Two classes are in scope:

- **Disproportionate cost from a request.** Request input that makes the toolkit spend memory,
  work, or DynamoDB calls beyond its documented cost model and the configured caps. An unbounded `?offset=` and an
  unbounded request body were fixed on these grounds.
- **A contract violation from a request or a stored item.** Request input or stored data that
  makes a documented component do what the adapter or its policy does not allow: write outside
  the request's scope, delete more than the request names, or change an object's prototype.
  Prototype pollution through path helpers, PATCH bodies, and stored key values was fixed on these
  grounds.

## Out of scope

**Calling the API in a loop.** A proof of concept that calls `Adapter` methods or exported
helpers directly and reports that _n_ operations take _n_ units of time, or _n_ DynamoDB calls,
measures work the caller chose to do. A report needs an attacker model: who supplies the input,
through which documented entry point, under what policy, and what the attacker gains that the
caller did not already have.

**Offset pagination's cost.** Offset pagination (`getList`, `?offset=`) reads the items it skips,
keeps reading pages until `limit` items match a filter, and by default counts the rest of the range
for the total, so one request with a selective filter can read most of a table. That is the
documented cost model, described on the wiki's [Pagination](https://github.com/uhop/dynamodb-toolkit/wiki/Pagination)
page. Cursor pagination (`getPage`, `?cursor`) reads about `limit` items per page and is the
alternative for any listing a client can filter or page freely.

**Access control.** The toolkit authenticates and authorizes nobody. A mounted REST handler serves
whatever its adapter exposes, and restricting who reaches it, or scoping each request through
`exampleFromContext`, belongs to your service.

**Design-time input.** Expression strings, hooks, and adapter definitions come from the developer.
A pathological expression string you wrote yourself, such as one that makes a regular expression
over `UpdateExpression` slow, is outside the trust boundary above.

**The CLI importing the module you name.** `dynamodb-toolkit ensure-table <module>` imports and
runs that module, which is its job. Pointing it at a file you do not trust runs that file.

**Input past a cap you raised.** Request bodies the toolkit reads itself are capped at 1 MiB by
default (`maxBodyBytes`); a body that an Express or Koa body parser has already parsed is under
that parser's cap. The REST policy caps page sizes and offsets. Raising a cap accepts the cost
deliberately.

## Scoring

The attack vector in the base score follows how the vulnerable component is reached:

- **`AV:N` for the HTTP layer.** The REST handler, the framework adapters (`express`, `koa`,
  `fetch`, `lambda`), and the `rest-core` parsers exist to process requests from your service's
  clients, which can arrive from the open network. A vulnerability an attacker reaches by sending
  such a request, including one in a shared helper the REST layer calls, is scored `AV:N`.
- **`AV:L` for everything else.** The `Adapter` called from your code, the expression builders,
  the batch and mass helpers, marshalling, provisioning, and the CLI bind no network stack and take
  their input from your code. Whether that input arrived over a network is a property of your
  deployment, which CVSS expresses through the consumer's environmental metrics rather than the
  base vector.

Advisories here are scored that way, and a report submitted with `AV:N` for a component outside the
HTTP layer is rescored rather than rejected.

## Hardening already shipped

The repository has no [published advisories](https://github.com/uhop/dynamodb-toolkit/security/advisories)
yet. Hardening that shipped in regular releases:

- path helpers refuse `__proto__`, `constructor`, and `prototype` segments, and PATCH parsing and
  keyed reads use null-prototype accumulators (3.1.1);
- batch retries stop after 8 attempts, request bodies over 1 MiB get `413 PayloadTooLarge`, and
  `?offset=` is capped at 100,000 by default (3.1.1);
- the body cap counts bytes, not characters, and write routes reject a body that is not an object
  with `400 BadBody` (3.1.2);
- an unscoped `DELETE /` requires `?confirm=true`, and cursor tokens are validated at the boundary
  (`parseCursor`) (3.8.0).

## Supported versions

Fixes are released against the latest published version. Please upgrade to the latest
`dynamodb-toolkit` release before reporting, and pin the fixed version once one is available.

## Disclosure process

- We aim to acknowledge a report within a few business days.
- We work to a coordinated-disclosure timeline (up to 90 days by default) and will keep you
  updated on progress toward a fix.
- With your permission, we credit reporters in the release notes and advisory. We are happy to
  coordinate a CVE through GitHub's CNA once a fix is validated.

Thank you for helping keep the ecosystem safe.
