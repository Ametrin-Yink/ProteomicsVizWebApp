"""Test that Parquet dependencies are available."""

import pytest


def test_pyarrow_available():
    """Verify pyarrow is installed and functional."""
    import pyarrow
    assert pyarrow.__version__ is not None


def test_pyarrow_parquet_available():
    """Verify pyarrow Parquet support is available."""
    import pyarrow.parquet as pq
    assert pq is not None


def test_pyarrow_can_read_write_parquet(tmp_path):
    """Verify pyarrow can read and write Parquet files."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    # Create simple table
    table = pa.table({
        'col1': [1, 2, 3],
        'col2': ['a', 'b', 'c']
    })

    # Write to Parquet
    output_path = tmp_path / "test.parquet"
    pq.write_table(table, output_path)

    # Read back
    table_read = pq.read_table(output_path)

    assert table_read.num_rows == 3
    assert table_read.column_names == ['col1', 'col2']
