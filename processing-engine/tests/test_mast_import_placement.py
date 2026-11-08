"""Regression test for issue #1261: MAST import placement."""

import ast
import unittest
from pathlib import Path


SOURCE = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "mast"
    / "mast_service.py"
)


class TestMastImportPlacement(unittest.TestCase):
    def test_table_converter_imports_are_at_module_scope(self):
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))

        module_imports = {
            alias.name
            for node in tree.body
            if isinstance(node, ast.Import)
            for alias in node.names
        }

        converter = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef)
            and node.name == "_table_to_dict_list"
        )

        local_imports = {
            alias.name
            for node in ast.walk(converter)
            if isinstance(node, ast.Import)
            for alias in node.names
        }

        required = {"math", "time", "numpy"}

        self.assertTrue(
            required.issubset(module_imports),
            f"Missing module imports: {required - module_imports}",
        )
        self.assertTrue(
            required.isdisjoint(local_imports),
            f"Redundant function imports: {required & local_imports}",
        )


if __name__ == "__main__":
    unittest.main()
