from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from utils.cli import build_parser
from utils.updater import check_for_update, install_update


class UpdaterTests(TestCase):
    def test_cli_exposes_update_and_check_modes(self) -> None:
        self.assertEqual(build_parser().parse_args(["update"]).command, "update")
        self.assertTrue(build_parser().parse_args(["update", "--check"]).check)

    def test_check_reports_commits_behind_main(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".git").mkdir()
            with (
                patch("utils.updater._program", return_value="git"),
                patch("utils.updater._run", side_effect=["", "2"]),
            ):
                status = check_for_update(root)
        self.assertTrue(status.available)
        self.assertEqual(status.commits_behind, 2)

    def test_install_fast_forwards_and_refreshes_dependencies(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".git").mkdir()
            commands: list[tuple[str, ...]] = []

            def run(_root: Path, *command: str) -> str:
                commands.append(command)
                if "rev-list" in command:
                    return "1"
                return ""

            with (
                patch("utils.updater._program", side_effect=lambda name: name),
                patch("utils.updater._run", side_effect=run),
            ):
                status = install_update(root)

        self.assertTrue(status.updated)
        self.assertTrue(any("pull" in command for command in commands))
        self.assertTrue(any("sync" in command for command in commands))
        self.assertTrue(any("install" in command for command in commands))
        self.assertTrue(
            any("scripts/launch-desktop.mjs" in command for command in commands)
        )
