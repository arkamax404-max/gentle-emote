## Summary

## Related issue

Write the closing reference on its own line and never inside a code block: GitHub ignores closing keywords that appear inside fenced blocks, so a fenced reference does not close the issue when the pull request merges.

Closes #

Use an open, classified issue in `arkamax404-max/gentle-emotex` that already has the `approved` label. `Closes #123` is the reference the check reads and the reference GitHub uses to close the issue. A placeholder is not a reference.

OWNER-only administrative housekeeping (not runtime features) may instead use this line alone:

```text
Administrative-exception: owner-maintenance
```

This does not waive the owner-merge record described below or validation of any issue references included in the body.

## Owner merge

A pull request authored by the sole maintainer cannot receive an approving review from that same account. Record the review that preceded the merge with one standalone line:

```text
Owner-merge: self-reviewed, independent review <reference>
```

The record does not replace the linked-issue check, automated checks, or any review the change's workflow requires.

## Type

- [ ] bug
- [ ] enhancement
- [ ] documentation
- [ ] performance
- [ ] refactor
- [ ] security

## Tests

## Documentation

- [ ] README or other docs updated
- [ ] No doc change needed
