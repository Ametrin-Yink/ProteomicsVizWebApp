# 07 - Security Guidelines

**Purpose:** Define security requirements and best practices

---

## File Upload Security

### File Type Validation
```python
# services/file_validation.py

from pathlib import Path
from typing import Set

ALLOWED_EXTENSIONS: Set[str] = {'.csv', '.tsv', '.txt'}
MAX_FILE_SIZE: int = 500 * 1024 * 1024  # 500MB

def validate_file_type(filename: str) -> None:
    """Validate file extension."""
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValidationError(
            f"Invalid file type: {ext}. "
            f"Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"
        )

def validate_file_content(file: UploadFile) -> None:
    """Validate file content (magic numbers)."""
    # Read first few bytes
    header = file.file.read(1024)
    file.file.seek(0)
    
    # Check for common malicious signatures
    if header.startswith(b'<?php'):
        raise ValidationError("Invalid file content: PHP detected")
    if header.startswith(b'#!/'):
        raise ValidationError("Invalid file content: script detected")
    
    # For CSV, check it's actually text
    try:
        header.decode('utf-8')
    except UnicodeDecodeError:
        raise ValidationError("Invalid file content: not valid text")
```

### File Size Validation (Streaming)
```python
# services/file_upload.py

async def validate_file_size(file: UploadFile) -> None:
    """Validate file size using streaming to avoid loading into memory."""
    size = 0
    chunk_size = 1024 * 1024  # 1MB chunks
    
    while chunk := await file.read(chunk_size):
        size += len(chunk)
        if size > MAX_FILE_SIZE:
            raise FileTooLargeError(
                f"File too large: {size / (1024*1024):.1f}MB. "
                f"Maximum: {MAX_FILE_SIZE / (1024*1024)}MB"
            )
    
    # Reset file pointer
    await file.seek(0)
```

### Filename Sanitization
```python
# utils/security.py

import re
from werkzeug.utils import secure_filename

def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent path traversal."""
    # Remove path components
    filename = secure_filename(filename)
    
    # Additional validation
    if '..' in filename:
        raise ValidationError("Invalid filename: path traversal detected")
    
    if filename.startswith('/'):
        raise ValidationError("Invalid filename: absolute path detected")
    
    # Whitelist allowed characters
    if not re.match(r'^[\w\-\.]+$', filename):
        raise ValidationError("Invalid filename: illegal characters")
    
    return filename
```

---

## Session Security

### Session ID Generation
```python
# core/security.py

import secrets
import hashlib

def generate_session_id() -> str:
    """Generate cryptographically secure session ID."""
    # 256 bits of entropy
    return secrets.token_urlsafe(32)

def generate_csrf_token() -> str:
    """Generate CSRF protection token."""
    return secrets.token_urlsafe(32)
```

### Session Isolation
```python
# core/config.py

from pathlib import Path

# Session storage outside web root
SESSION_BASE_PATH = Path("/var/lib/proteomics/sessions")

def get_session_path(session_id: str) -> Path:
    """Get isolated session directory."""
    # Validate ID format
    if not re.match(r'^[A-Za-z0-9_-]+$', session_id):
        raise ValueError("Invalid session ID format")
    
    path = SESSION_BASE_PATH / session_id
    
    # Ensure path is within base directory
    try:
        path.relative_to(SESSION_BASE_PATH)
    except ValueError:
        raise ValueError("Invalid session ID: path traversal")
    
    return path
```

### Session Cleanup
```python
# services/session_manager.py

import shutil

def delete_session(session_id: str) -> None:
    """Securely delete session data."""
    session_path = get_session_path(session_id)
    
    if not session_path.exists():
        return
    
    # Verify path is still valid
    try:
        session_path.relative_to(SESSION_BASE_PATH)
    except ValueError:
        raise SecurityError("Invalid session path")
    
    # Delete entire directory
    shutil.rmtree(session_path)
```

---

## Input Sanitization

### Filename Parsing
```python
# utils/parsers.py

def parse_psm_filename(filename: str) -> ParsedFilename:
    """Parse PSM filename with strict validation."""
    # Whitelist pattern
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

### SQL Injection Prevention
```python
# NEVER use string formatting for queries
# WRONG ❌
cursor.execute(f"SELECT * FROM sessions WHERE id = '{session_id}'")

# CORRECT ✅
cursor.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
```

### XSS Prevention
```typescript
// React automatically escapes, but be careful with:

// WRONG ❌ - dangerouslySetInnerHTML
div dangerouslySetInnerHTML={{ __html: userInput }}

// CORRECT ✅ - Let React escape
<div>{userInput}</div>

// If you must use HTML, sanitize first
import DOMPurify from 'dompurify';
const clean = DOMPurify.sanitize(dirtyHtml);
```

---

## CORS Configuration

```python
# core/config.py

from fastapi.middleware.cors import CORSMiddleware

# Development - permissive
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Production - restrictive
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://proteomics-app.com"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
```

---

## Rate Limiting

```python
# middleware/rate_limit.py

from fastapi import Request, HTTPException
import time
from collections import defaultdict

class RateLimiter:
    def __init__(self, max_requests: int = 100, window: int = 60):
        self.max_requests = max_requests
        self.window = window
        self.requests = defaultdict(list)
    
    async def check(self, request: Request):
        client_ip = request.client.host
        now = time.time()
        
        # Clean old requests
        self.requests[client_ip] = [
            req_time for req_time in self.requests[client_ip]
            if now - req_time < self.window
        ]
        
        # Check limit
        if len(self.requests[client_ip]) >= self.max_requests:
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please try again later."
            )
        
        self.requests[client_ip].append(now)

# Apply to specific endpoints
@app.post("/upload")
async def upload_file(request: Request, limiter: RateLimiter = Depends()):
    await limiter.check(request)
    # ... handle upload
```

---

## Secrets Management

### Environment Variables
```python
# core/config.py

from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Database
    database_url: str = "sqlite:///./proteomics.db"
    
    # Security
    secret_key: str  # Generate with: openssl rand -hex 32
    
    # File upload
    max_upload_size: int = 500 * 1024 * 1024
    upload_dir: str = "./uploads"
    
    # R configuration
    r_libs_user: str = "./r_libs"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
```

### .env.example
```bash
# Security
SECRET_KEY=your-secret-key-here-generate-with-openssl-rand-hex-32

# Database
DATABASE_URL=sqlite:///./proteomics.db

# File upload
MAX_UPLOAD_SIZE=524288000
UPLOAD_DIR=./uploads

# R
R_LIBS_USER=./r_libs
```

---

## HTTPS Enforcement

```python
# middleware/https.py

from fastapi import Request, HTTPException

class HTTPSRedirectMiddleware:
    async def __call__(self, request: Request, call_next):
        if request.headers.get("X-Forwarded-Proto") == "http":
            raise HTTPException(
                status_code=400,
                detail="HTTPS required"
            )
        return await call_next(request)

# Add in production
if not settings.debug:
    app.add_middleware(HTTPSRedirectMiddleware)
```

---

## Security Headers

```python
# middleware/security_headers.py

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        
        # Prevent clickjacking
        response.headers["X-Frame-Options"] = "DENY"
        
        # XSS protection
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        
        # Content Security Policy
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:;"
        )
        
        return response

app.add_middleware(SecurityHeadersMiddleware)
```

---

## Data Protection

### Sensitive Data Logging
```python
# NEVER log sensitive data

# WRONG ❌
logger.info(f"User uploaded file: {file_content}")

# CORRECT ✅
logger.info(
    "File uploaded",
    extra={
        "filename": filename,
        "size": file_size,
        "session_id": session_id,
        # NOT file content
    }
)
```

### Temporary File Handling
```python
import tempfile
import os

async def process_uploaded_file(upload_file: UploadFile):
    """Process file in secure temporary directory."""
    # Create temp file
    with tempfile.NamedTemporaryFile(
        delete=False,
        suffix='.csv',
        dir='/tmp/proteomics'  # Restricted directory
    ) as tmp:
        tmp_path = Path(tmp.name)
        
        try:
            # Write uploaded content
            content = await upload_file.read()
            tmp.write(content)
            tmp.flush()
            
            # Process
            result = await process_file(tmp_path)
            
        finally:
            # Always cleanup
            if tmp_path.exists():
                os.unlink(tmp_path)
    
    return result
```

---

## Security Checklist

### Development
- [ ] No hardcoded secrets
- [ ] Input validation on all endpoints
- [ ] File type and size validation
- [ ] Error messages don't leak sensitive info
- [ ] Dependencies regularly updated

### Production
- [ ] HTTPS enforced
- [ ] Security headers configured
- [ ] Rate limiting enabled
- [ ] CORS restricted to known origins
- [ ] Session storage secured
- [ ] File uploads scanned (if possible)
- [ ] Logging configured (no sensitive data)
- [ ] Regular security audits

---

## Next Steps

See [08-performance.md](08-performance.md) for performance optimization.
