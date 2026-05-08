"""Tests for TaskManager — centralized background computation manager."""

import asyncio
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from app.services.task_manager import (
    TaskManager,
    TaskKind,
    TaskInfo,
    TaskCancelledError,
    TaskTimeoutError,
    task_manager,  # singleton
)


def test_task_kind_enum():
    """TaskKind covers all defined calculation types."""
    assert TaskKind.PIPELINE.value == "pipeline"
    assert TaskKind.GSEA.value == "gsea"
    assert TaskKind.BIONET.value == "bionet"
    assert TaskKind.COMPUTE.value == "compute"
    assert TaskKind.LIGHT.value == "light"
