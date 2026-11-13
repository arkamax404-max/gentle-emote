"""Public CLI contract; gh is mocked and no user configuration is read."""
import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import unittest
from unittest.mock import call, patch


CLI = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/validate-pr-issue.py"))
REPO = "arkamax404-max/gentle-emote"
UPSTREAM = "efolchmontiel/gentle-emote"
MARKER = "Administrative-exception: owner-maintenance"
GOOD = {"state": "open", "labels": [{"name": "bug"}, {"name": "approved"}]}
MISSING = ("pull request body needs a closing reference such as 'Closes #123' "
           f"for an open, approved issue in {REPO}")


class RepositoryContextCLI(unittest.TestCase):
    def check_cli(self, *, args=(), env=None, issue=None, response=None,
                  error=None, lookups=(), stdout=None):
        environment = {"PR_REPOSITORY": REPO, "PR_BODY": "Closes #10",
                       "PR_AUTHOR": "guest", "PR_AUTHOR_ASSOCIATION": "CONTRIBUTOR",
                       "PR_BASE": "main"}
        environment.update(env or {})
        environment = {key: value for key, value in environment.items() if value is not None}
        reply = response or subprocess.CompletedProcess(
            [], 0, json.dumps(GOOD if issue is None else issue), "")
        out, err = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, environment, clear=True), \
             patch.object(sys, "argv", ["validate-pr-issue.py", *args]), \
             patch.object(subprocess, "run", return_value=reply) as gh, \
             contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = CLI["main"]()
            except SystemExit as exc:
                code = exc.code
        self.assertEqual(code, 1 if error else 0)
        self.assertEqual(out.getvalue(), stdout if stdout is not None else
                         ("" if error else "linked-issue: ok\n"))
        self.assertEqual(err.getvalue(), f"linked-issue: {error}\n" if error else "")
        self.assertEqual(gh.call_args_list, [
            call(["gh", "api", f"repos/{repo}/issues/{number}"],
                 check=False, capture_output=True, text=True) for repo, number in lookups])

    def test_trusted_environment_scopes_local_reference(self):
        self.check_cli(lookups=[(REPO, 10)])

    def test_explicit_repository_overrides_environment(self):
        self.check_cli(args=["--repository", REPO], env={"PR_REPOSITORY": UPSTREAM},
                       lookups=[(REPO, 10)])

    def test_same_repository_qualified_and_url_are_case_insensitive(self):
        for ref in ("ArKaMaX404-MaX/Gentle-Emote#10",
                    "https://github.com/ArKaMaX404-MaX/Gentle-Emote/issues/10"):
            with self.subTest(ref=ref):
                self.check_cli(env={"PR_BODY": f"Fixes {ref}"}, lookups=[(REPO, 10)])

    def test_foreign_references_rejected_before_any_lookup(self):
        for repo in (UPSTREAM, "other/repo"):
            for ref in (f"{repo}#10", f"https://github.com/{repo}/issues/10"):
                with self.subTest(ref=ref):
                    self.check_cli(env={"PR_BODY": f"Closes #10\nFixes {ref}"},
                                   error=f"#10 points at {repo}, not {REPO}")

    def test_missing_context_fails_closed_even_for_owner(self):
        for repository in (None, ""):
            for body, association in (("Closes #10", "CONTRIBUTOR"), (MARKER, "OWNER")):
                with self.subTest(repository=repository, association=association):
                    self.check_cli(env={"PR_REPOSITORY": repository, "PR_BODY": body,
                                        "PR_AUTHOR_ASSOCIATION": association},
                                   error="repository context is missing")

    def test_malformed_context_fails_closed_even_for_owner(self):
        for repo in ("owner", "owner/repo/extra", "https://github.com/owner/repo",
                     "../repo", "owner/..", " owner/repo", "owner/repo ",
                     "owner/re po", "ownér/repo", "owner/repo\n"):
            for body, association in (("Closes #10", "CONTRIBUTOR"), (MARKER, "OWNER")):
                with self.subTest(repo=repo, association=association):
                    self.check_cli(env={"PR_REPOSITORY": repo, "PR_BODY": body,
                                        "PR_AUTHOR_ASSOCIATION": association},
                                   error=f"invalid repository context: {repo!r}")

    def test_owner_exception_remains_exact_and_owner_only(self):
        self.check_cli(env={"PR_BODY": MARKER, "PR_AUTHOR_ASSOCIATION": "OWNER"})
        for body in (MARKER.lower(), MARKER + " extra", "prefix " + MARKER):
            with self.subTest(body=body):
                self.check_cli(env={"PR_BODY": body, "PR_AUTHOR_ASSOCIATION": "OWNER"}, error=MISSING)
        self.check_cli(env={"PR_BODY": MARKER, "PR_AUTHOR_ASSOCIATION": "COLLABORATOR"},
                       error="administrative exception is only valid for the repository owner, not 'guest'")
        self.check_cli(env={"PR_BODY": MARKER + "\nCloses #10", "PR_AUTHOR_ASSOCIATION": "OWNER"},
                       issue={"state": "closed"}, error="#10 is not open", lookups=[(REPO, 10)])

    def test_existing_body_author_association_and_base_options(self):
        self.check_cli(args=["--body", "Fixes #10", "--author", "contributor",
                             "--author-association", "NONE", "--base", "main"],
                       env={"PR_BODY": "", "PR_BASE": "develop"}, lookups=[(REPO, 10)])
        self.check_cli(args=["--base", "develop"], error="pull request target must be main, got 'develop'")
        self.check_cli(args=["--body", MARKER, "--author", "outsider", "--author-association", "NONE"],
                       error="administrative exception is only valid for the repository owner, not 'outsider'")
        self.check_cli(args=["--body", "Related to #10"], error=MISSING)

    def test_existing_issue_rejection_messages(self):
        cases = [({**GOOD, "state": "closed"}, "#10 is not open"),
                 ({**GOOD, "pull_request": {"url": "x"}}, "#10 is a pull request, not an issue"),
                 ({"state": "open", "labels": [{"name": "approved"}]},
                  "#10 needs a classification label: bug, documentation, enhancement, performance, refactor, security"),
                 ({"state": "open", "labels": [{"name": "bug"}]},
                  "#10 is not approved. The maintainer adds the 'approved' label before a pull request can merge.")]
        for issue, error in cases:
            with self.subTest(error=error):
                self.check_cli(issue=issue, error=error, lookups=[(REPO, 10)])

    def test_existing_transport_errors(self):
        for response, error in ((subprocess.CompletedProcess([], 1, "", "Not Found\n"),
                                 "#10 could not be read: Not Found"),
                                (subprocess.CompletedProcess([], 0, "not json", ""),
                                 "#10 returned a response that is not JSON")):
            with self.subTest(error=error):
                self.check_cli(response=response, error=error, lookups=[(REPO, 10)])

    def test_original_self_test(self):
        self.check_cli(args=["--self-test"], env={"PR_REPOSITORY": None},
                       stdout="self-test: 15 cases passed\n")

    def test_help_documents_repository_option(self):
        out, err = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, {}, clear=True), \
             patch.object(sys, "argv", ["validate-pr-issue.py", "--help"]), \
             patch.object(subprocess, "run") as gh, \
             contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            with self.assertRaises(SystemExit) as exit_info:
                CLI["main"]()
        self.assertEqual(exit_info.exception.code, 0)
        self.assertEqual(err.getvalue(), "")
        self.assertIn("--repository", out.getvalue())
        gh.assert_not_called()


if __name__ == "__main__":
    unittest.main()
