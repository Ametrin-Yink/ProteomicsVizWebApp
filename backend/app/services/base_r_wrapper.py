"""
Base class for R subprocess wrappers (Template Method pattern).

Shared subprocess management, calibration, and error handling used by
Msqrob2Wrapper and MsstatsWrapper. Subclasses override two abstract
config-building methods and pass tool-specific parameters via constructor.
"""

from abc import ABC, abstractmethod
import asyncio
import json
import logging
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Optional

from app.core.config import settings
from app.core.exceptions import RScriptError
from app.models.analysis import AnalysisConfig

logger = logging.getLogger("proteomics")


async def _safe_log(callback, level: str, message: str) -> None:
    """Call a log callback safely, supporting both sync and async callbacks."""
    if callback is None:
        return
    try:
        if asyncio.iscoroutinefunction(callback):
            await callback(level, message)
        else:
            callback(level, message)
    except Exception:
        pass


def _execute_batch(
    batch_items: list[dict],
    batch_idx: int,
    n_cores_per: int,
    build_batch_cmd: callable,
) -> dict:
    """Run a single batch subprocess (called from ProcessPoolExecutor worker).

    This is a module-level function so it can be pickled by ProcessPoolExecutor.
    """
    cmd, timeout = build_batch_cmd(batch_items, batch_idx, n_cores_per)
    t0 = time.time()
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
        elapsed = time.time() - t0
        if result.returncode == 0:
            if result.stderr:
                logger.debug("Batch %d stderr: %s", batch_idx, result.stderr[:500])
            return {"batch_idx": batch_idx, "ok": True, "elapsed": elapsed}
        else:
            error_msg = (
                result.stderr[:500]
                if result.stderr
                else f"exit code {result.returncode}"
            )
            return {
                "batch_idx": batch_idx,
                "ok": False,
                "elapsed": elapsed,
                "error": error_msg,
            }
    except subprocess.TimeoutExpired:
        elapsed = time.time() - t0
        return {
            "batch_idx": batch_idx,
            "ok": False,
            "elapsed": elapsed,
            "error": "timeout",
        }


class BaseRWrapper(ABC):
    """Template method for R subprocess wrappers.

    Subclasses must implement:
      - _build_data_process_config(config, n_cores) -> dict
      - _build_gc_config(config, n_cores, **extra) -> dict

    Constructor parameters supply tool-specific script names, prefixes,
    and timeout settings, avoiding abstract property boilerplate.
    """

    def __init__(
        self,
        *,
        cal_prefix: str,
        benchmark_script: str,
        data_process_script: str,
        gc_script: str,
        verify_script: str,
        dp_timeout: int,
        gc_timeout: int,
    ):
        self.r_executable = settings.r_executable
        self._optimal_ncores: int | None = None
        self.timeout = settings.r_script_timeout
        self.scripts_dir = Path(__file__).resolve().parent.parent.parent / "scripts"

        self._cal_prefix = cal_prefix
        self._benchmark_script_name = benchmark_script
        self._data_process_script_name = data_process_script
        self._gc_script_name = gc_script
        self._verify_script_name = verify_script
        self._dp_timeout = dp_timeout
        self._gc_timeout = gc_timeout

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    def get_optimal_ncores(self) -> int | None:
        """Return the cached optimal n_cores from calibration, or None."""
        return self._optimal_ncores

    # ------------------------------------------------------------------
    # Abstract: subclass-specific config builders
    # ------------------------------------------------------------------

    @abstractmethod
    def _build_data_process_config(self, config: AnalysisConfig, n_cores: int) -> dict:
        """Build the JSON config dict for the data_process R script."""
        ...

    @abstractmethod
    def _build_gc_config(self, config: AnalysisConfig, n_cores: int, **extra) -> dict:
        """Build the JSON config dict for the group_comparison R script."""
        ...

    # ------------------------------------------------------------------
    # N-cores resolution (Phase 3: skip calibration when n_cores=1)
    # ------------------------------------------------------------------

    async def _resolve_n_cores(
        self,
        config: AnalysisConfig,
        config_attr: str,
        input_file: Path,
        log_callback=None,
    ) -> int:
        """Resolve n_cores: explicit > cached calibration > run calibration > 4.

        If the user explicitly set n_cores=1, calibration is skipped entirely.
        """
        explicit = getattr(config, config_attr, None)
        if explicit is not None:
            if explicit == 1:
                logger.info("n_cores=1 explicitly set, skipping calibration")
                await _safe_log(
                    log_callback,
                    "info",
                    "Single-core mode: skipping parallel calibration",
                )
            return explicit

        if self._optimal_ncores is not None:
            return self._optimal_ncores

        try:
            return await self._calibrate_ncores(input_file, config, log_callback)
        except Exception:
            return 4

    # ------------------------------------------------------------------
    # Calibration (Phase 2: disk persistence)
    # ------------------------------------------------------------------

    @property
    def _calibration_cache_path(self) -> Path:
        return settings.sessions_dir / ".cache" / "calibration.json"

    def _load_calibration_from_disk(self) -> int | None:
        """Try to load a previously persisted calibration result."""
        path = self._calibration_cache_path
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            entry = data.get(self._cal_prefix)
            if entry and isinstance(entry.get("n_cores"), int):
                logger.info(
                    "Loaded calibration from disk: n_cores=%d (from %s)",
                    entry["n_cores"],
                    entry.get("timestamp", "unknown"),
                )
                return entry["n_cores"]
        except Exception as e:
            logger.warning("Failed to load calibration from disk: %s", e)
        return None

    def _save_calibration_to_disk(self, n_cores: int) -> None:
        """Persist calibration result to disk for future restarts."""
        import time

        path = self._calibration_cache_path
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            data: dict = {}
            if path.exists():
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                except Exception:
                    pass
            data[self._cal_prefix] = {"n_cores": n_cores, "timestamp": time.time()}
            path.write_text(json.dumps(data, indent=2), encoding="utf-8")
            logger.info("Saved calibration to disk: n_cores=%d", n_cores)
        except Exception as e:
            logger.warning("Failed to save calibration to disk: %s", e)

    async def _calibrate_ncores(
        self, input_file: Path, config=None, log_callback=None
    ) -> int:
        """Benchmark worker counts [1,4,8,16,32]; return the fastest.

        Checks in-memory cache first, then disk cache, then runs the
        5-subprocess benchmark. Result is cached in memory and on disk.
        """
        if self._optimal_ncores is not None:
            return self._optimal_ncores

        cached = self._load_calibration_from_disk()
        if cached is not None:
            self._optimal_ncores = cached
            return cached

        logger.info("Calibrating optimal SnowParam worker count...")
        await _safe_log(
            log_callback,
            "info",
            "Calibrating optimal CPU core count for parallel processing...",
        )

        candidate_counts = [1, 4, 8, 16, 32]
        best_n = 4
        best_time = float("inf")

        for n in candidate_counts:
            await _safe_log(log_callback, "info", f"  Benchmarking {n} cores...")
            try:
                elapsed = await self._benchmark_ncores(input_file, n, config)
                logger.info(f"  n_cores={n}: {elapsed:.1f}s")
                if elapsed < best_time:
                    best_time = elapsed
                    best_n = n
            except Exception as e:
                logger.warning(f"  n_cores={n}: calibration failed ({e})")

        self._optimal_ncores = best_n
        self._save_calibration_to_disk(best_n)
        logger.info(
            "Calibration complete: optimal n_cores=%d (%.1fs)",
            best_n,
            best_time,
        )
        await _safe_log(
            log_callback,
            "info",
            f"Optimal core count: {best_n} (completed in {best_time:.0f}s)",
        )
        return best_n

    async def _benchmark_ncores(
        self, input_file: Path, n_cores: int, config=None
    ) -> float:
        """Run a benchmark with n_cores on a 100K-row data slice.

        Reads the input once (cached on first call), reuses the slice.
        Temp files include a UUID to avoid concurrent-session collisions.
        """
        import time
        import uuid

        uid = uuid.uuid4().hex[:8]
        prefix = self._cal_prefix
        slice_file = input_file.parent / f"{prefix}_{uid}_{n_cores}.parquet"
        rds_file = input_file.parent / f"{prefix}_{uid}_{n_cores}.rds"
        out_file = input_file.parent / f"{prefix}_{uid}_{n_cores}.tsv"

        try:
            slice_df = self._calibration_slice_df
        except AttributeError:
            import pandas as pd

            df = pd.read_parquet(input_file)
            self._calibration_slice_df = df.head(100000)
            slice_df = self._calibration_slice_df

        slice_df.to_parquet(slice_file)

        bench_config = self._build_data_process_config(
            config or AnalysisConfig(),
            n_cores,
        )
        # Override to use fast defaults during calibration
        bench_config["min_peptides"] = 1

        script_path = self.scripts_dir / self._benchmark_script_name
        config_json = json.dumps(bench_config)
        cmd = [
            self.r_executable,
            str(script_path),
            str(slice_file),
            str(out_file),
            str(rds_file),
            "",
            config_json,
        ]

        try:
            start = time.time()
            await self._run_r_script(cmd, script_path, timeout=120)
            return time.time() - start
        finally:
            for f in [slice_file, rds_file, out_file]:
                f.unlink(missing_ok=True)

    # ------------------------------------------------------------------
    # Subprocess execution (100% shared)
    # ------------------------------------------------------------------

    async def _run_r_script(
        self,
        cmd: list[str],
        script_path: Path,
        log_callback: Optional[callable] = None,
        timeout: int | None = None,
    ) -> None:
        """Run an R script via subprocess with real-time output streaming and heartbeat."""
        effective_timeout = timeout if timeout is not None else self.timeout
        logger.info(f"Starting R script with timeout {effective_timeout}s")

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=os.environ,
        )

        stdout_lines: list[str] = []
        stderr_lines: list[str] = []

        def stream_output(
            pipe, lines_list, log_prefix, log_level="info", log_cb=None, event_loop=None
        ):
            try:
                for line in iter(pipe.readline, ""):
                    if not line:
                        break
                    line = line.rstrip("\n\r")
                    lines_list.append(line)
                    logger.info(f"{log_prefix}: {line}")
                    if log_cb and event_loop:
                        try:
                            asyncio.run_coroutine_threadsafe(
                                log_cb(log_level, line),
                                event_loop,
                            )
                        except Exception:
                            pass
                pipe.close()
            except Exception as e:
                logger.error(f"Error reading {log_prefix}: {e}")

        stdout_thread = threading.Thread(
            target=stream_output,
            args=(process.stdout, stdout_lines, "R", "info", log_callback, loop),
            daemon=True,
        )
        stderr_thread = threading.Thread(
            target=stream_output,
            args=(process.stderr, stderr_lines, "R-err", "warning", log_callback, loop),
            daemon=True,
        )
        stdout_thread.start()
        stderr_thread.start()

        heartbeat_stop = threading.Event()

        def heartbeat():
            count = 0
            while not heartbeat_stop.is_set():
                if heartbeat_stop.wait(60):
                    break
                count += 1
                msg = f"Still working... ({count * 60}s elapsed)"
                logger.info(f"Heartbeat: {msg}")
                if log_callback and loop:
                    try:
                        asyncio.run_coroutine_threadsafe(
                            log_callback("info", msg),
                            loop,
                        )
                    except Exception:
                        pass

        heartbeat_thread = threading.Thread(target=heartbeat, daemon=True)
        heartbeat_thread.start()

        try:
            await asyncio.to_thread(process.wait, timeout=effective_timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            await asyncio.to_thread(process.wait)
            stdout_thread.join(timeout=5)
            stderr_thread.join(timeout=5)
            raise
        finally:
            heartbeat_stop.set()
            heartbeat_thread.join(timeout=1)

        stdout_thread.join(timeout=30)
        stderr_thread.join(timeout=30)

        stdout_str = "\n".join(stdout_lines)
        stderr_str = "\n".join(stderr_lines)

        if process.returncode != 0:
            error_msg = stderr_str if stderr_str else "Unknown error"
            logger.error(
                f"R script failed with return code {process.returncode}: {error_msg}"
            )
            raise RScriptError(
                message=error_msg,
                details={
                    "returncode": process.returncode,
                    "stderr": error_msg[:500],
                    "stdout": stdout_str[:500],
                    "script": str(script_path),
                },
            )

    # ------------------------------------------------------------------
    # Batched subprocess execution
    # ------------------------------------------------------------------

    async def run_batched(
        self,
        *,
        items: list[dict],
        batch_size: int,
        max_workers: int,
        n_cores_cap: int,
        build_batch_cmd,
        log_callback=None,
    ) -> None:
        """Split items into batches and execute concurrently via ProcessPoolExecutor.

        When len(items) <= batch_size, runs a single batch via _run_r_script
        (no parallelism overhead). Used by MSstats Step 7 to parallelize
        groupComparison across many comparisons.
        """
        import concurrent.futures

        n_total = len(items)
        total_cores = os.cpu_count() or 4

        if n_total <= batch_size:
            logger.info("Batch mode: %d items, single batch (no parallelism)", n_total)
            n_cores_per = max(1, min(total_cores, n_cores_cap))
            cmd, timeout = build_batch_cmd(items, 0, n_cores_per)
            await self._run_r_script(
                cmd,
                self.scripts_dir / self._gc_script_name,
                log_callback=log_callback,
                timeout=timeout,
            )
            return

        batches: list[list[dict]] = []
        for i in range(0, n_total, batch_size):
            batches.append(items[i : i + batch_size])

        n_batches = len(batches)
        effective_workers = min(n_batches, max_workers)
        n_cores_per = max(1, min(total_cores // effective_workers, n_cores_cap))

        logger.info(
            "Batch mode: %d items -> %d batches (size=%d), %d concurrent, %d cores/process",
            n_total,
            n_batches,
            batch_size,
            effective_workers,
            n_cores_per,
        )
        if log_callback:
            await _safe_log(
                log_callback,
                "info",
                f"Splitting {n_total} items into {n_batches} batches "
                f"({n_cores_per} cores each, {effective_workers} concurrent)",
            )

        failures: list[tuple[int, str]] = []
        t0_total = time.time()

        loop = asyncio.get_running_loop()

        try:
            with concurrent.futures.ProcessPoolExecutor(
                max_workers=effective_workers,
            ) as executor:
                futures = []
                for idx, batch_items in enumerate(batches):
                    fut = loop.run_in_executor(
                        executor,
                        _execute_batch,
                        batch_items,
                        idx,
                        n_cores_per,
                        build_batch_cmd,
                    )
                    futures.append((idx, fut))

                for idx, fut in futures:
                    try:
                        result = await fut
                        batch_num = idx + 1
                        if result["ok"]:
                            msg = (
                                f"Batch {batch_num}/{n_batches} complete "
                                f"({result['elapsed']:.0f}s)"
                            )
                            logger.info(msg)
                            if log_callback:
                                await _safe_log(log_callback, "info", msg)
                        else:
                            msg = (
                                f"Batch {batch_num}/{n_batches} FAILED: "
                                f"{result.get('error', 'unknown')}"
                            )
                            logger.error(msg)
                            failures.append((idx, result.get("error", "unknown")))
                    except Exception as e:
                        msg = f"Batch {idx + 1}/{n_batches} FAILED: {e}"
                        logger.error(msg)
                        failures.append((idx, str(e)))
        except asyncio.CancelledError:
            logger.warning(
                "run_batched cancelled - %d/%d batches may have partial results",
                len([f for _, f in futures if f.done()]),
                n_batches,
            )
            raise

        elapsed_total = time.time() - t0_total
        logger.info("All batches complete in %.0fs", elapsed_total)

        if failures:
            batch_nums = [str(i + 1) for i, _ in failures]
            raise RuntimeError(
                f"Step 7 batching failed: batches {', '.join(batch_nums)} failed. "
                "Partial results for other batches are available in the output "
                "directory."
            )

    # ------------------------------------------------------------------
    # Pre-flight memory check (Phase 4)
    # ------------------------------------------------------------------

    async def _check_memory_headroom(
        self,
        input_file: Path,
        n_cores: int,
        log_callback=None,
    ) -> int:
        """Estimate memory footprint; fall back to serial if excessive.

        If n_rows * n_cols * (n_cores + 1) exceeds 500M cells, the
        parallel run risks exhausting memory — fall back to single-core.
        """
        if n_cores <= 1:
            return n_cores

        try:
            n_rows, n_cols = await self._get_file_dimensions(input_file)
        except Exception as e:
            logger.warning("Could not estimate memory: %s", e)
            return n_cores

        worker_multiplier = n_cores + 1  # main proc + workers
        estimated_cells = n_rows * n_cols * worker_multiplier

        CELL_THRESHOLD = 500_000_000  # 500M cells

        logger.info(
            "Memory estimate: %d rows x %d cols x %d workers = %.0fM cells",
            n_rows,
            n_cols,
            worker_multiplier,
            estimated_cells / 1e6,
        )

        if estimated_cells > CELL_THRESHOLD:
            logger.warning(
                "Estimated memory footprint exceeds threshold (%.0fM > 500M). "
                "Falling back to serial processing.",
                estimated_cells / 1e6,
            )
            await _safe_log(
                log_callback,
                "warning",
                "Dataset is large — falling back to single-core to avoid "
                "memory exhaustion",
            )
            return 1

        return n_cores

    async def _get_file_dimensions(self, path: Path) -> tuple[int, int]:
        """Get (n_rows, n_cols) without loading the full dataset."""
        if path.suffix == ".parquet":
            import pyarrow.parquet as pq

            pf = pq.ParquetFile(path)
            n_rows = pf.metadata.num_rows
            n_cols = len(pf.schema_arrow.names)
            return n_rows, n_cols
        else:
            # TSV: count columns from header line, rows via fast scan
            with open(path, encoding="utf-8", errors="replace") as f:
                header = f.readline()
                n_cols = len(header.split("\t"))
                n_rows = sum(1 for _ in f)
            return n_rows, n_cols

    # ------------------------------------------------------------------
    # Package verification
    # ------------------------------------------------------------------

    async def verify_r_packages(self) -> dict:
        """Verify that required R packages are installed."""
        script_path = self.scripts_dir / self._verify_script_name

        if not script_path.exists():
            return {
                "success": False,
                "error": f"Verification script not found: {script_path}",
            }

        try:

            def run_verify():
                return subprocess.run(
                    [self.r_executable, str(script_path)],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    timeout=60,
                )

            process = await asyncio.to_thread(run_verify)

            stdout_str = process.stdout if process.stdout else ""
            stderr_str = process.stderr if process.stderr else ""

            if process.returncode == 0:
                return {"success": True, "output": stdout_str}
            else:
                return {
                    "success": False,
                    "error": stderr_str or "Unknown error",
                    "output": stdout_str,
                }

        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Verification timed out"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # Pipeline step templates
    # ------------------------------------------------------------------

    async def data_process(
        self,
        input_file: Path,
        output_file: Path,
        rds_output: Path,
        gene_mapping_file: Optional[Path] = None,
        config: Optional[AnalysisConfig] = None,
        log_callback: Optional[callable] = None,
        timeout: int | None = None,
        timeout_multiplier: int = 1,
    ) -> Path:
        """Step 6: Calculate protein abundance via R subprocess."""
        logger.info(
            "Step 6: Calculating protein abundance",
            extra={"session_id": "unknown", "input": str(input_file)},
        )

        script_path = self.scripts_dir / self._data_process_script_name

        if not script_path.exists():
            raise RScriptError(
                message=f"R script not found: {script_path}",
                details={"script": str(script_path)},
            )

        cfg = config if config else AnalysisConfig()

        # Resolve n_cores then check memory headroom
        n_cores = await self._resolve_n_cores(
            cfg,
            self._n_cores_config_attr,
            input_file,
            log_callback,
        )
        if n_cores > 1:
            n_cores = await self._check_memory_headroom(
                input_file,
                n_cores,
                log_callback,
            )

        r_config = self._build_data_process_config(cfg, n_cores)
        config_json = json.dumps(r_config)

        cmd = [
            self.r_executable,
            str(script_path),
            str(input_file),
            str(output_file),
            str(rds_output),
            str(gene_mapping_file) if gene_mapping_file else "",
            config_json,
        ]

        logger.info(f"R command: {' '.join(cmd)}")

        try:
            effective_timeout = (
                timeout if timeout is not None else self._dp_timeout
            ) * timeout_multiplier
            await self._run_r_script(
                cmd, script_path, log_callback, timeout=effective_timeout
            )

            logger.info(
                "Step 6 complete: Protein abundance calculated",
                extra={"output": str(output_file)},
            )
            return output_file

        except subprocess.TimeoutExpired:
            raise RScriptError(
                message=f"Protein abundance calculation timed out after "
                f"{effective_timeout}s",
                details={"timeout": effective_timeout},
            )
        except RScriptError:
            raise
        except Exception as e:
            import traceback

            raise RScriptError(
                message=f"Protein abundance calculation failed: {e}",
                details={"error": str(e), "traceback": traceback.format_exc()},
            )

    async def group_comparison_multi(
        self,
        rds_file: Path,
        output_dir: Path,
        comparisons: list[dict],
        gene_mapping_file: Optional[Path] = None,
        config: Optional[AnalysisConfig] = None,
        log_callback: Optional[callable] = None,
        timeout: int | None = None,
        timeout_multiplier: int = 1,
        **extra,
    ) -> Path:
        """Step 7: Differential expression via R subprocess."""
        logger.info(
            "Step 7 (multi): Running multi-condition DE",
            extra={"input": str(rds_file), "comparisons": len(comparisons)},
        )

        script_path = self.scripts_dir / self._gc_script_name

        if not script_path.exists():
            raise RScriptError(
                message=f"R script not found: {script_path}",
                details={"script": str(script_path)},
            )

        comparisons_json = json.dumps(comparisons)

        cfg = config if config else AnalysisConfig()

        # Resolve n_cores
        n_cores = await self._resolve_n_cores(
            cfg,
            self._n_cores_config_attr,
            rds_file,
            log_callback,
        )
        if n_cores > 1:
            n_cores = await self._check_memory_headroom(
                rds_file,
                n_cores,
                log_callback,
            )

        gc_config = self._build_gc_config(cfg, n_cores, **extra)
        config_json = json.dumps(gc_config)

        # Build positional args (subclasses provide extra positional via _build_cmd_extras)
        extras = self._build_cmd_extras(**extra)
        cmd = [
            self.r_executable,
            str(script_path),
            str(rds_file),
            str(output_dir),
            comparisons_json,
            *extras,
            str(gene_mapping_file) if gene_mapping_file else "",
            config_json,
        ]

        logger.info(f"R command: {' '.join(cmd[:5])}...")

        try:
            effective_timeout = (
                timeout if timeout is not None else self._gc_timeout
            ) * timeout_multiplier
            await self._run_r_script(
                cmd, script_path, log_callback, timeout=effective_timeout
            )

            logger.info(
                "Step 7 (multi) complete: DE calculated",
                extra={"output_dir": str(output_dir)},
            )
            return output_dir

        except subprocess.TimeoutExpired:
            raise RScriptError(
                message=f"DE analysis timed out after {effective_timeout}s",
                details={"timeout": effective_timeout},
            )
        except RScriptError:
            raise
        except Exception as e:
            import traceback

            raise RScriptError(
                message=f"DE analysis failed: {e}",
                details={"error": str(e), "traceback": traceback.format_exc()},
            )

    # ------------------------------------------------------------------
    # Hooks with defaults (subclasses may override)
    # ------------------------------------------------------------------

    @property
    def _n_cores_config_attr(self) -> str:
        """AnalysisConfig attribute name for n_cores. Override if needed."""
        return "msqrob2_n_cores"

    def _build_cmd_extras(self, **extra) -> list[str]:
        """Extra positional arguments for the group_comparison command.

        Override in subclass to insert additional positional args
        (e.g., covariates_json for MSstats) between comparisons_json
        and gene_mapping_file.
        """
        return []
