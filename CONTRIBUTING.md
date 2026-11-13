# Contributing to gentle-emote

Only the fork maintainer, [arkamax404-max](https://github.com/arkamax404-max), can merge into `main` in `arkamax404-max/gentle-emote`. Upstream authorship and license attribution are unchanged.

## 1. Open an issue

Use a template in this fork. Describe the problem before the change. The issue needs one classification label: `bug`, `enhancement`, `documentation`, `performance`, `refactor`, or `security`. Do not disclose vulnerabilities in public issues; the template's upstream security contact is for upstream vulnerabilities only, not fork reports.

## 2. Wait for approval

Do not open a pull request until the maintainer adds the `approved` label. An open issue without that label cannot be merged.

## 3. Open the pull request

- Branch name: `type/short-description`, for example `fix/talk-timing`.
- The body must contain a closing reference to the approved issue: `Closes #123`.
- The issue has to be open, in `arkamax404-max/gentle-emote`, and classified.
- The pull request needs an approving review from someone other than its author, unless the sole maintainer authored it and satisfies `## Owner merge`.

OWNER-only administrative housekeeping may use the exact standalone line `Administrative-exception: owner-maintenance` instead of a closing reference. This exception is not for runtime features, does not waive the owner-merge record in `## Owner merge`, and does not excuse invalid issue references included in the body. Other author associations cannot use it.

## Owner merge

GitHub does not allow an author to approve their own pull request, so a pull request authored by the sole maintainer cannot satisfy an approving-review requirement with that account. Such a pull request may be merged without a second review only when all of the following hold:

- the linked issue is open, classified in this fork, and carries the `approved` label, or the pull request is administrative housekeeping covered by the OWNER-only marker above and links no issue at all;
- the linked-issue check passes on the pull request;
- every required automated check passes;
- any review the change's workflow requires has completed, and its outcome is recorded;
- the pull request body carries one standalone line naming that review evidence: `Owner-merge: self-reviewed, independent review <reference>`.

That line is a record, not a permission. It never substitutes for the linked-issue check, for automated checks, or for a review the change's workflow requires, and a human still reads it before merging. A pull request not authored by the sole maintainer needs an approving review from someone other than its author.

## Validator repository context

The linked-issue workflow supplies `PR_REPOSITORY` from trusted `${{ github.repository }}` context, never from the PR body or head checkout. It executes the validator from the trusted base SHA with a read-only token.

For local validation, supply `PR_REPOSITORY=arkamax404-max/gentle-emote` or `--repository arkamax404-max/gentle-emote`; the flag overrides the environment. Context must be an ASCII GitHub `owner/name`, not a URL or path. Missing or malformed context fails closed, even for OWNER maintenance. There is no upstream fallback.

`Closes #123`, `Closes arkamax404-max/gentle-emote#123`, and `Closes https://github.com/arkamax404-max/gentle-emote/issues/123` resolve to this fork. Repository comparison is case-insensitive. Any foreign reference, including an upstream issue, rejects the PR before any issue lookup. The open/classified/approved issue checks remain mandatory for supplied references.

## Merge policy and enforcement

Policy prohibits direct pushes to `main` by anyone except the maintainer, prohibits merges without the linked-issue check, and requires an approving review from someone other than the author unless the sole maintainer authored the pull request under `## Owner merge`. This is normative policy, not a claim that remote branch protection is installed. The owner-merge record is read by a human; this policy does not claim the validator enforces it. The tracked ruleset is an optional enforcement template; it is not evidence of active remote settings and must be independently verified before use.
