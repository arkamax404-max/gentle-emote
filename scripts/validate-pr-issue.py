#!/usr/bin/env python3
"""Validate that a pull request links an open, classified, approved issue.

The workflow checks out the base branch and runs this file from that
checkout. It reads the pull request body from the environment. It does
not execute code from the pull request.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections.abc import Callable

REPOSITORY_PATTERN = re.compile(
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?/[A-Za-z0-9_.-]{1,100}"
)
CLASSIFICATION = frozenset(
    {"bug", "enhancement", "documentation", "performance", "refactor", "security"}
)
APPROVED = "approved"
EXCEPTION_LINE = "Administrative-exception: owner-maintenance"
REFERENCE = re.compile(
    r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+"
    r"(?:https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/issues/(\d+)"
    r"|([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)#(\d+)"
    r"|#(\d+))",
    re.IGNORECASE,
)

IssueFetcher = Callable[[str, int], dict]


class ValidationError(Exception):
    pass


def closing_references(body: str, repository: str) -> list[tuple[str, int]]:
    found: list[tuple[str, int]] = []
    for match in REFERENCE.finditer(body or ""):
        url_owner, url_repo, url_number, short_owner, short_repo, short_number, local = match.groups()
        if local:
            found.append((repository, int(local)))
            continue
        if url_number:
            found.append((f"{url_owner}/{url_repo}", int(url_number)))
            continue
        found.append((f"{short_owner}/{short_repo}", int(short_number)))
    return found


def has_exception(body: str) -> bool:
    return any(line.strip() == EXCEPTION_LINE for line in (body or "").splitlines())


def validate(
    *,
    body: str,
    author: str,
    author_association: str,
    base: str,
    repository: str,
    fetch_issue: IssueFetcher,
) -> None:
    if not repository:
        raise ValidationError("repository context is missing")
    if (not REPOSITORY_PATTERN.fullmatch(repository)
            or repository.split("/")[1] in {".", ".."}
            or "--" in repository.split("/")[0]):
        raise ValidationError(f"invalid repository context: {repository!r}")
    repository = repository.casefold()

    if base != "main":
        raise ValidationError(f"pull request target must be main, got {base!r}")

    exception = has_exception(body)
    if exception and author_association != "OWNER":
        raise ValidationError(
            f"administrative exception is only valid for the repository owner, not {author!r}"
        )

    refs = closing_references(body, repository)
    if not refs and not exception:
        raise ValidationError(
            "pull request body needs a closing reference such as 'Closes #123' "
            f"for an open, approved issue in {repository}"
        )

    # Scope every reference before making even the first API request.
    for repo, number in refs:
        if repo.casefold() != repository:
            raise ValidationError(f"#{number} points at {repo}, not {repository}")
    for _, number in refs:
        issue = fetch_issue(repository, number)
        if issue.get("pull_request") is not None:
            raise ValidationError(f"#{number} is a pull request, not an issue")
        if issue.get("state") != "open":
            raise ValidationError(f"#{number} is not open")
        names = {label.get("name", "") for label in issue.get("labels", [])}
        classified = sorted(names & CLASSIFICATION)
        if not classified:
            raise ValidationError(
                f"#{number} needs a classification label: {', '.join(sorted(CLASSIFICATION))}"
            )
        if APPROVED not in names:
            raise ValidationError(
                f"#{number} is not approved. The maintainer adds the '{APPROVED}' label before a pull request can merge."
            )


def fetch_issue_from_github(repo: str, number: int) -> dict:
    completed = subprocess.run(
        ["gh", "api", f"repos/{repo}/issues/{number}"],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip().splitlines()
        message = detail[-1] if detail else "GitHub API request failed"
        raise ValidationError(f"#{number} could not be read: {message}")
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ValidationError(f"#{number} returned a response that is not JSON") from error
    if not isinstance(payload, dict):
        raise ValidationError(f"#{number} returned an unexpected response")
    return payload


def self_test() -> None:
    # Historical fixture context, never a default for real pull requests.
    repository = "efolchmontiel/gentle-emote"
    issues = {
        10: {"state": "open", "labels": [{"name": "bug"}, {"name": "approved"}]},
        11: {"state": "open", "labels": [{"name": "approved"}]},
        12: {"state": "closed", "labels": [{"name": "enhancement"}, {"name": "approved"}]},
        13: {"state": "open", "labels": [{"name": "documentation"}, {"name": "approved"}], "pull_request": {"url": "x"}},
        14: {"state": "open", "labels": [{"name": "bug"}]},
    }

    def fetch(repo: str, number: int) -> dict:
        if repo != repository or number not in issues:
            raise ValidationError(f"#{number} could not be read: Not Found")
        return issues[number]

    def expect_fail(**kwargs: str) -> None:
        try:
            validate(repository=repository, fetch_issue=fetch, **kwargs)
        except ValidationError:
            return
        raise AssertionError(f"expected failure for {kwargs!r}")

    validate(
        body="Closes #10",
        author="guest",
        author_association="CONTRIBUTOR",
        base="main",
        repository=repository,
        fetch_issue=fetch,
    )
    validate(
        body="See https://github.com/efolchmontiel/gentle-emote/issues/10\n\nFixes #10",
        author="guest",
        author_association="CONTRIBUTOR",
        base="main",
        repository=repository,
        fetch_issue=fetch,
    )
    validate(
        body="Administrative-exception: owner-maintenance\n",
        author="efolchmontiel",
        author_association="OWNER",
        base="main",
        repository=repository,
        fetch_issue=fetch,
    )
    expect_fail(body="Closes #", author="guest", author_association="NONE", base="main")
    expect_fail(body="Related to #10", author="guest", author_association="NONE", base="main")
    expect_fail(body="Closes #10", author="guest", author_association="NONE", base="develop")
    expect_fail(
        body="Closes https://github.com/other/repo/issues/10",
        author="guest",
        author_association="NONE",
        base="main",
    )
    expect_fail(body="Closes other/repo#10", author="guest", author_association="NONE", base="main")
    expect_fail(body="Closes #11", author="guest", author_association="NONE", base="main")
    expect_fail(body="Closes #12", author="guest", author_association="NONE", base="main")
    expect_fail(body="Closes #13", author="guest", author_association="NONE", base="main")
    expect_fail(body="Closes #14", author="guest", author_association="NONE", base="main")
    expect_fail(body="Closes #404", author="guest", author_association="NONE", base="main")
    expect_fail(
        body="Administrative-exception: owner-maintenance",
        author="guest",
        author_association="COLLABORATOR",
        base="main",
    )
    expect_fail(
        body="Administrative-exception: owner-maintenance\n\nCloses #404",
        author="efolchmontiel",
        author_association="OWNER",
        base="main",
    )
    print("self-test: 15 cases passed")


def main() -> int:
    if "--self-test" in sys.argv:
        self_test()
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repository", default=os.environ.get("PR_REPOSITORY", ""),
        help="required owner/name context (default: PR_REPOSITORY); use trusted workflow context",
    )
    parser.add_argument("--body", default=os.environ.get("PR_BODY", ""))
    parser.add_argument("--author", default=os.environ.get("PR_AUTHOR", ""))
    parser.add_argument("--author-association", default=os.environ.get("PR_AUTHOR_ASSOCIATION", ""))
    parser.add_argument("--base", default=os.environ.get("PR_BASE", ""))
    args = parser.parse_args()
    try:
        validate(
            body=args.body,
            author=args.author,
            author_association=args.author_association,
            base=args.base,
            repository=args.repository,
            fetch_issue=fetch_issue_from_github,
        )
    except ValidationError as error:
        print(f"linked-issue: {error}", file=sys.stderr)
        return 1
    print("linked-issue: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
