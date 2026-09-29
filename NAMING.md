# Naming

Checked on 2026-09-29. The repo is not renamed.

## The current name cannot be published

`crawler-prerender` is already taken on npm: version 0.1.1 by XavierTM ("Prerendering for Single
Page Applications to improve SEO"), last published 2022-04-27, and a GitHub repo of the same
name, last pushed 2020-12-16. Both are stale, but an npm name in use cannot be reused. The npm
`name` in package.json is a placeholder until one of the options below is chosen. The GitHub repo
`reidifydesign/crawler-prerender` has no clash on the studio account.

## Three options

| | Name | npm | GitHub | Why |
|---|---|---|---|---|
| 1 | `crawler-snapshot` | free (404) | no repo with this exact name. Nearest are `Producters/express-crawler-snapshots` (9 stars, last pushed 2017) and `MarcMagnin/WebCrawlerSnapshot` (2015), both dead | Says what it does in the two words a person would type into a search. Weakest as a brand |
| 2 | `botsnap` | free (404) | no repo with this exact name in use. Three `BotSnap` repos exist, all Snapchat-related or empty, 0 stars, last pushed 2024 or earlier, and no user or organisation of that name | Short and easy to say. Snapshots for bots. Some Snapchat noise in search |
| 3 | `seenbybots` | free (404) | no repos, no user or organisation | Leans on the `check` half ("what bots see"), and is the most distinctive. Longest, and undersells `snapshot` |

## Recommendation

`crawler-snapshot` if search is the priority (the README's job is to be found by someone typing
what they need). `botsnap` if a short brand matters more. If neither, a scoped package
(`@reidify/...`) avoids every npm clash, at the cost of a longer install line.

## Names looked at and rejected

| Name | Reason |
|---|---|
| `crawlview` | Taken on npm by a tool that overlaps `check` (see SUPPLY-CHECK.md) |
| `crawlready` | Taken on npm (an "AI readiness CLI", published 2026-05) |
| `botview` | Taken on npm (empty description, 2022) |
| `crawlsnap` | Taken on npm by an unrelated API SDK |
| `prerender-kit` | Free on npm but `lzwme/prerender-kit` is a headless-browser SPA prerender tool on GitHub, so it would be confused with it |
| `botsee` | A GitHub organisation and an active repo use it (an AI visibility monitoring plugin) |
| `botrender` | A GitHub user of that name exists, and 27 repos carry it |

Sources: `registry.npmjs.org/<name>` status codes, `gh api search/repositories` with `in:name`,
and `gh api users/<name>`.
