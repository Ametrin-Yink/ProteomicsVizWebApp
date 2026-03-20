# 12 - Data Validation

**Purpose:** Define validation rules for all data inputs and outputs

---

## CSV File Validation

### Required Columns
```python
REQUIRED_COLUMNS = [
    'Sequence',
    'Modifications',
    'Charge',
    'Contaminant',
    'Master Protein Accessions',
    'Quan Info',
]

DYNAMIC_COLUMNS = [
    r'Abundance F\d+ Sample',  # Regex pattern
]
```

### Column Validation
```python
def validate_csv_columns(df: pd.DataFrame) -> List[str]:
    """Validate CSV has all required columns."""
    missing = []
    
    # Check required columns
    for col in REQUIRED_COLUMNS:
        if col not in df.columns:
            missing.append(col)
    
    # Check for at least one abundance column
    abundance_cols = [c for c in df.columns if re.match(r'Abundance F\d+ Sample', c)]
    if not abundance_cols:
        missing.append('Abundance F{code} Sample')
    
    if missing:
        raise ValidationError(f"Missing required columns: {', '.join(missing)}")
    
    return abundance_cols
```

### Data Type Validation
```python
def validate_data_types(df: pd.DataFrame) -> None:
    """Validate column data types."""
    validations = {
        'Sequence': 'string',
        'Charge': 'int',
        'Contaminant': 'bool',
        'Abundance': 'float',
    }
    
    for col, expected_type in validations.items():
        if col not in df.columns:
            continue
        
        actual_type = df[col].dtype
        if expected_type == 'int' and not pd.api.types.is_integer_dtype(actual_type):
            raise ValidationError(f"Column '{col}' should be integer, got {actual_type}")
        elif expected_type == 'float' and not pd.api.types.is_float_dtype(actual_type):
            raise ValidationError(f"Column '{col}' should be float, got {actual_type}")
```

---

## Filename Validation

### PSM Filename Pattern
```python
def validate_psm_filename(filename: str) -> ParsedFilename:
    """Validate and parse PSM filename."""
    pattern = r'^PSM_([A-Za-z0-9_-]+)_([A-Za-z0-9_-]+)_(\d+)\.csv$'
    
    match = re.match(pattern, filename)
    if not match:
        raise ValidationError(
            f"Invalid filename: {filename}. "
            f"Expected: PSM_ExperimentName_Condition_ReplicateNumber.csv"
        )
    
    return ParsedFilename(
        experiment=match.group(1),
        condition=match.group(2),
        replicate=int(match.group(3))
    )
```

### Filename Security
```python
def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent path traversal."""
    # Remove path components
    filename = os.path.basename(filename)
    
    # Remove null bytes
    filename = filename.replace('\x00', '')
    
    # Whitelist allowed characters
    if not re.match(r'^[\w\-\.]+$', filename):
        raise ValidationError("Filename contains illegal characters")
    
    return filename
```

---

## Configuration Validation

### Session Config
```python
from pydantic import BaseModel, validator

class SessionConfig(BaseModel):
    treatment: str = Field(..., min_length=1)
    control: str = Field(..., min_length=1)
    organism: str = Field(..., pattern=r'^[a-z]+$')
    remove_razor: bool = False
    strict_filtering: bool = False
    
    @validator('control')
    def control_differs_from_treatment(cls, v, values):
        if 'treatment' in values and v == values['treatment']:
            raise ValueError('Control must differ from treatment')
        return v
    
    @validator('organism')
    def organism_exists(cls, v):
        available = get_available_organisms()
        if v not in available:
            raise ValueError(f'Organism {v} not available')
        return v
```

### File Selection Validation
```python
def validate_file_selection(files: List[ParsedFilename]) -> None:
    """Validate selected files meet requirements."""
    
    # Check same experiment
    experiments = set(f.experiment for f in files)
    if len(experiments) > 1:
        raise ValidationError(
            f"Samples must be from the same experiment. "
            f"Found: {', '.join(experiments)}"
        )
    
    # Check exactly 2 conditions
    conditions = set(f.condition for f in files)
    if len(conditions) != 2:
        raise ValidationError(
            f"Sample must be from 2 conditions for paired comparison. "
            f"Found: {len(conditions)}"
        )
    
    # Check minimum replicates
    for condition in conditions:
        replicates = [f for f in files if f.condition == condition]
        if len(replicates) < 3:
            raise ValidationError(
                f"At least 3 replicates per condition required. "
                f"Condition '{condition}' has only {len(replicates)}"
            )
```

---

## R Output Validation

### Protein Abundance Output
```python
def validate_protein_abundance_output(df: pd.DataFrame) -> None:
    """Validate R protein abundance output."""
    required_cols = ['Master_Protein_Accessions', 'Gene_Name']
    
    missing = set(required_cols) - set(df.columns)
    if missing:
        raise ValidationError(f"R output missing columns: {missing}")
    
    if df.empty:
        raise ValidationError("R output is empty")
    
    if df.isna().all().all():
        raise ValidationError("R output is all NaN")
```

### Differential Expression Output
```python
def validate_diff_expression_output(df: pd.DataFrame) -> None:
    """Validate R differential expression output."""
    required_cols = ['logFC', 'pval', 'adjPval']
    
    missing = set(required_cols) - set(df.columns)
    if missing:
        raise ValidationError(f"R output missing columns: {missing}")
    
    # Check p-values in valid range
    if (df['pval'] < 0).any() or (df['pval'] > 1).any():
        raise ValidationError("Invalid p-values in output")
    
    if (df['adjPval'] < 0).any() or (df['adjPval'] > 1).any():
        raise ValidationError("Invalid adjusted p-values in output")
```

---

## GSEA Output Validation

```python
def validate_gsea_output(df: pd.DataFrame) -> None:
    """Validate GSEA results."""
    required_cols = ['term', 'es', 'nes', 'pval', 'fdr']
    
    missing = set(required_cols) - set(df.columns)
    if missing:
        raise ValidationError(f"GSEA output missing columns: {missing}")
    
    # Check NES values
    if df['nes'].isna().all():
        raise ValidationError("All NES values are NaN")
```

---

## Next Steps

See [13-lessons-learned.md](13-lessons-learned.md) for lessons from development.
