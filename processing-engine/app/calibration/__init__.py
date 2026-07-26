# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Calibration Recipes — declarative jwst-pipeline runs (#1709).

Recipes are pure data (stage toggles + scalar parameter overrides) executed
by the engine's trusted executor. User Python is never executed; notebooks
are *parsed* into recipes (importer, PR 9), not run.
"""
