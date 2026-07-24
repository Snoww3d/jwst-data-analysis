# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""JWPipeNB notebook importer (#1709 PR 9).

Statically parses an STScI jwst-pipeline-notebook (.ipynb) into a
CalibrationRecipe. The notebook is treated as DATA: cells are parsed with
``ast`` and **never executed**. Extraction is fail-closed:

- only recognized template patterns are extracted (config assignments,
  ``do<stage>`` toggles, ``<stage>dict['step']['param'] = <literal>``
  overrides, ``Observations.query_criteria`` literal kwargs);
- a non-literal value on a recognized target rejects the import (we would
  otherwise silently guess);
- notebooks that don't carry the template's essential markers are rejected
  with the supported vintage named;
- everything else (association helpers, visualization, custom analysis) is
  ignored for extraction and reported as warnings so the user knows what the
  recipe does NOT carry over.

Extracted overrides still pass the executor's security allowlist
(``validate_step_overrides``) before a recipe is created.
"""

import ast
import json
from dataclasses import dataclass, field
from typing import Any

from app.calibration.executor import RecipeValidationError, validate_step_overrides
from app.calibration.models import CalibrationRecipe


SUPPORTED_VINTAGE = "JWPipeNB Build 12.3 / jwst 2.0.x"
MAX_NOTEBOOK_BYTES = 5 * 1024 * 1024

_STAGE_DICTS = {"det1dict": "detector1", "image2dict": "image2", "image3dict": "image3"}
_TOGGLES = {"dodet1": "detector1", "doimage2": "image2", "doimage3": "image3"}
_IMAGING_INSTRUMENTS = {
    "NIRCAM/IMAGE": "nircam",
    "NIRISS/IMAGE": "niriss",
    "MIRI/IMAGE": "miri",
}


class NotebookImportError(ValueError):
    """The notebook cannot be imported; message names the reason/location."""


@dataclass
class _Extraction:
    program: str | None = None
    observation: str | None = None
    filters: list[str] = field(default_factory=list)
    instrument: str | None = None
    toggles: dict[str, bool] = field(default_factory=dict)
    overrides: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def _literal(node: ast.expr) -> Any:
    """Literal scalar / flat list, or raise ValueError."""
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        inner = _literal(node.operand)
        if isinstance(inner, int | float):
            return -inner
        raise ValueError("non-numeric negation")
    if isinstance(node, ast.List | ast.Tuple):
        return [_literal(item) for item in node.elts]
    raise ValueError("not a literal")


def _subscript_chain(target: ast.expr) -> tuple[str, str, str] | None:
    """Match ``name['step']['param']`` → (name, step, param)."""
    if not (isinstance(target, ast.Subscript) and isinstance(target.value, ast.Subscript)):
        return None
    outer, inner = target, target.value
    if not isinstance(inner.value, ast.Name):
        return None
    step = inner.slice
    param = outer.slice
    if not (isinstance(step, ast.Constant) and isinstance(param, ast.Constant)):
        return None
    if not (isinstance(step.value, str) and isinstance(param.value, str)):
        return None
    return inner.value.id, step.value, param.value


def _handle_assign(node: ast.Assign, cell_no: int, out: _Extraction) -> None:
    if len(node.targets) != 1:
        return  # tuple inits like `d['a'], d['b'] = {}, {}` — ignore
    target = node.targets[0]

    if isinstance(target, ast.Name):
        name = target.id
        if name in _TOGGLES:
            try:
                value = _literal(node.value)
            except ValueError:
                raise NotebookImportError(
                    f"cell {cell_no}, line {node.lineno}: '{name}' must be a literal True/False"
                ) from None
            if not isinstance(value, bool):
                raise NotebookImportError(
                    f"cell {cell_no}, line {node.lineno}: '{name}' must be a boolean"
                )
            out.toggles[_TOGGLES[name]] = value
        elif name in ("program", "proposal_id"):
            # First literal wins; the template later reuses `program` with
            # computed values (association cells) — those are ignored. Only
            # stage overrides are hard-fail on non-literals (they feed
            # Pipeline.call); identity fields are user-reviewable in the UI.
            try:
                value = str(_literal(node.value))
            except ValueError:
                if out.program is None:
                    out.warnings.append(
                        f"cell {cell_no}, line {node.lineno}: non-literal '{name}' ignored"
                    )
                return
            if out.program is None:
                out.program = value
        elif name in ("sci_observtn", "observtn", "obs_num"):
            try:
                value = str(_literal(node.value))
            except ValueError:
                return
            if out.observation is None:
                out.observation = value
        return

    chain = _subscript_chain(target)
    if chain is None:
        return
    dict_name, step, param = chain
    stage = _STAGE_DICTS.get(dict_name)
    if stage is None:
        return
    if isinstance(node.value, ast.Dict) and not node.value.keys:
        return  # `det1dict['jump'] = {}`-style init (single-subscript won't match here)
    try:
        value = _literal(node.value)
    except ValueError:
        raise NotebookImportError(
            f"cell {cell_no}, line {node.lineno}: override "
            f"{dict_name}['{step}']['{param}'] has a non-literal value — "
            "cannot import safely"
        ) from None
    out.overrides.setdefault(stage, {}).setdefault(step, {})[param] = value


def _handle_call(node: ast.Call, out: _Extraction) -> None:
    func = node.func
    if not (isinstance(func, ast.Attribute) and func.attr == "query_criteria"):
        return
    for keyword in node.keywords:
        if keyword.arg == "instrument_name":
            try:
                names = _literal(keyword.value)
            except ValueError:
                continue
            for raw in names if isinstance(names, list) else [names]:
                if isinstance(raw, str) and raw.upper() in _IMAGING_INSTRUMENTS:
                    out.instrument = _IMAGING_INSTRUMENTS[raw.upper()]
                elif isinstance(raw, str):
                    raise NotebookImportError(
                        f"instrument mode '{raw}' is not importable — only "
                        f"imaging modes are supported ({SUPPORTED_VINTAGE})"
                    )
        elif keyword.arg == "filters":
            try:
                values = _literal(keyword.value)
            except ValueError:
                continue
            for item in values if isinstance(values, list) else [values]:
                if isinstance(item, str) and item not in out.filters:
                    out.filters.append(item)


def parse_notebook(raw: bytes, filename: str) -> tuple[dict, list[str]]:
    """Parse a JWPipeNB .ipynb into recipe fields + warnings. Never executes."""
    if len(raw) > MAX_NOTEBOOK_BYTES:
        raise NotebookImportError("notebook exceeds the 5MB import limit")
    try:
        notebook = json.loads(raw.decode("utf-8"))
        cells = notebook["cells"]
        assert isinstance(cells, list)
    except Exception:
        raise NotebookImportError("not a valid .ipynb (JSON with a cells list)") from None

    out = _Extraction()
    for cell_no, cell in enumerate(cells, start=1):
        if not isinstance(cell, dict) or cell.get("cell_type") != "code":
            continue
        source = cell.get("source") or []
        text = "".join(source) if isinstance(source, list) else str(source)
        try:
            tree = ast.parse(text)
        except (SyntaxError, ValueError, RecursionError):
            # ValueError: null bytes in source; RecursionError: pathological
            # nesting within the size cap. Fail-open per cell — extraction is
            # already fail-closed on the essentials check.
            out.warnings.append(f"cell {cell_no}: unparseable — skipped")
            continue
        has_custom = False
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                _handle_assign(node, cell_no, out)
            elif isinstance(node, ast.Call):
                _handle_call(node, out)
            elif isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
                has_custom = True
        if has_custom:
            out.warnings.append(
                f"cell {cell_no}: custom code (function/class definitions) is not "
                "carried into the recipe"
            )

    missing = []
    if out.instrument is None:
        missing.append("an imaging instrument_name query")
    if out.program is None:
        missing.append("a 'program' assignment")
    if not out.toggles and not out.overrides:
        missing.append("stage toggles or stage parameter dicts")
    if missing:
        raise NotebookImportError(
            "not a recognizable JWPipeNB imaging notebook — missing "
            + ", ".join(missing)
            + f" (supported vintage: {SUPPORTED_VINTAGE})"
        )

    stages = []
    for stage_name in ("detector1", "image2", "image3"):
        step_overrides = out.overrides.get(stage_name, {})
        try:
            validate_step_overrides(stage_name, step_overrides)
        except RecipeValidationError as exc:
            raise NotebookImportError(f"unsafe override rejected: {exc}") from exc
        stages.append(
            {
                "name": stage_name,
                "enabled": out.toggles.get(stage_name, True),
                "step_overrides": step_overrides,
            }
        )

    base_name = filename.rsplit("/", 1)[-1][:80]
    recipe_fields = {
        "schema_version": 1,
        "name": f"Imported: {base_name}",
        "description": f"Imported from {base_name} (static parse — custom code, "
        "associations, and visualization are not carried over).",
        "instrument": out.instrument,
        "mode": "imaging",
        "source": "imported",
        "provenance": {"notebook_name": base_name, "jwst_version_authored": None},
        "input_source": {
            "type": "mast_query",
            "proposal_id": out.program.lstrip("0") or "0" if out.program else None,
            "observation": out.observation,
            "filters": out.filters,
            "calib_level": 1,
            "product_suffixes": ["_uncal"],
        },
        "stages": stages,
        "association": {
            "rule": "DMS_Level3_Base",
            "product_name": f"{out.instrument}-imported",
        },
        "output_suffixes": ["_i2d"],
    }
    return recipe_fields, out.warnings


def import_notebook(
    raw: bytes, filename: str, user_id: str, recipe_id: str
) -> tuple[CalibrationRecipe, list[str]]:
    """Full import: parse, then validate through the recipe schema."""
    fields, warnings = parse_notebook(raw, filename)
    fields["id"] = recipe_id
    fields["created_by"] = user_id
    try:
        recipe = CalibrationRecipe.model_validate(fields)
    except Exception as exc:
        raise NotebookImportError(f"extracted config failed validation: {exc}") from exc
    return recipe, warnings
