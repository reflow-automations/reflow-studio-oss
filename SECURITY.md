# Security policy

Reflow Studio is self-hosted. Every instance runs on its owner's own Vercel, Supabase and (optionally) Cloudflare accounts, with that owner's provider keys. This policy covers the code in this repository, not anyone's individual deployment.

## Supported versions

Security fixes go into the latest release only. Older releases do not get backports, so update regularly: watch the repository for releases (Watch, Custom, Releases) and read [CHANGELOG.md](CHANGELOG.md) before you update.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No, please update |

## Reporting a vulnerability

Please do **not** open a public issue, discussion or pull request for a security problem.

Report it privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability** ([direct link](https://github.com/reflow-automations/reflow-studio-oss/security/advisories/new)). Only the maintainers can read the report.

A good report contains:

- what an attacker can do, and what they need first (an anonymous visitor, a signed-in account that is not an owner, someone holding a share link, ...);
- the steps or a proof of concept, run against your own instance or a local setup;
- the release or commit you tested;
- whether you think it is being exploited already.

Never put real keys, tokens or personal data in a report. Use your own test instance and throwaway keys.

## What happens next

Reflow Studio is maintained in spare time, so response times are best effort:

- we acknowledge your report within 7 days;
- within 30 days you hear whether we treat it as a vulnerability and how we plan to fix or mitigate it;
- the fix ships as a release whose CHANGELOG entry tells self-hosters exactly what to do, together with a GitHub Security Advisory that credits you (unless you prefer to stay anonymous).

Please give us reasonable time to ship a fix before you disclose anything publicly. We agree on a disclosure date with you.

## Scope

In scope, for example:

- the owner gate: using an instance (web app, REST API or MCP server) without being on its owner list;
- API keys (`rfl_...`): forging them, leaking them, or using them beyond their scopes;
- provider keys saved in the app: reading them back or decrypting them;
- provider webhooks and the reconcile endpoint: getting a forged callback accepted;
- the database: row level security, grants or functions that let the `anon` or `authenticated` role read or change data;
- public share links: exposing more than the shared item and its whitelisted fields;
- server-side request forgery through media import, abuse of uploads, cross-site scripting in the library or on share pages;
- secrets that end up in the browser bundle.

Out of scope:

- the configuration of your own deployment (a weak secret, a bucket you made public, an owner list you widened yourself), unless our documentation told you to set it up that way;
- vulnerabilities in fal.ai, Kie.ai, Higgsfield, Vercel, Supabase or Cloudflare themselves: please report those to the vendor;
- spending on your own provider accounts, rate limits and denial of service against an instance;
- automated scanner output without a demonstrated impact, missing security headers without an exploit, and clickjacking on pages without sensitive actions;
- dependency advisories without a path to exploitation in this code (Dependabot tracks those; a pull request with the update is welcome);
- social engineering and physical attacks.

## Leaked keys

- **You leaked one of your own keys** (in an issue, a screenshot, a commit or a log): revoke it at the provider first (fal.ai, Kie.ai, Higgsfield, Supabase or Cloudflare), then put the new key in Settings, Providers or in your Vercel environment variables. Deleting the message is not enough: assume someone copied the key.
- **You found someone else's key in this repository or its history**: report it privately as described above, and do not use it.

## Hardening checklist for self-hosters

- Put only your own login email addresses in `OWNER_EMAILS`. In production the app lets nobody in while it is empty.
- Create your owner account before you share the URL of a new deployment.
- Keep the Supabase service role key and every provider key in server-side environment variables. Never give a secret a `NEXT_PUBLIC_` prefix.
- Set a monthly spend cap (`MONTHLY_BUDGET_USD`) and use the spending limits your providers offer.
- Back up the secret that encrypts the provider keys you save in the app (see `apps/web/.env.example`). Without it, those keys cannot be decrypted and you have to enter them again.
- Give each API key only the scopes it needs, and revoke keys you no longer use (Settings, API keys).
- Leave Vercel's Git Fork Protection on, so pull requests from forks never receive your environment variables.
- Update when a release mentions a security fix.
